import { Router } from 'express';
import { getNextId } from '../db.js';
import { Pedido } from '../models/Pedido.js';
import { Producto } from '../models/Producto.js';
import {
  notificarPedidoTransferencia,
  notificarComprobante,
  notificarPagoConfirmado,
  notificarPagoRechazado,
} from '../notificaciones.js';

const router = Router();
const redondear2 = (n) => Math.round(Number(n) * 100) / 100;
const ahora = () => new Date().toISOString();

// Descuenta stock una sola vez. Se llama al confirmar el pago (manual o por pasarela).
export async function descontarStockPedido(pedido) {
  if (!pedido || pedido.stockDescontado) return;
  for (const it of pedido.items || []) {
    if (it.id != null && Number(it.cantidad) > 0) {
      await Producto.findOneAndUpdate({ id: it.id }, { $inc: { stock: -Number(it.cantidad) } });
    }
  }
  pedido.stockDescontado = true;
}

// GET /api/pedidos?estadoPago=&estadoPedido=&metodoPago=
router.get('/', async (req, res) => {
  try {
    const { estadoPago, estadoPedido, metodoPago } = req.query;
    const query = {};
    if (estadoPago) query.estadoPago = estadoPago;
    if (estadoPedido) query.estadoPedido = estadoPedido;
    if (metodoPago) query.metodoPago = metodoPago;
    // ?resumen=1 -> versión ligera (sin la imagen del comprobante) para los avisos del POS
    if (req.query.resumen === '1') {
      const resumen = await Pedido.find(query)
        .sort({ id: -1 })
        .select('id fecha total metodoPago estadoPago estadoPedido cliente.nombre comprobante')
        .lean();
      return res.json(
        resumen.map(({ comprobante, ...p }) => ({ ...p, tieneComprobante: Boolean(comprobante) }))
      );
    }
    const pedidos = await Pedido.find(query).sort({ id: -1 }).lean();
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await Pedido.findOne({ id: Number(req.params.id) }).lean();
    if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseCheckoutBody(body) {
  const { items, cliente, entrega, metodoPago, envio, notas } = body || {};
  const listaItems = Array.isArray(items) ? items : [];
  if (listaItems.length === 0) return { error: 'El pedido no tiene productos' };
  const metodosValidos = ['efectivo', 'transferencia', 'stripe', 'mercadopago'];
  if (!metodosValidos.includes(metodoPago)) return { error: 'Método de pago inválido' };
  const cli = cliente || {};
  if (!cli.nombre || !String(cli.nombre).trim()) return { error: 'El nombre del cliente es obligatorio' };
  if (!cli.telefono || !String(cli.telefono).trim()) return { error: 'El teléfono del cliente es obligatorio' };
  const tipoEntrega = entrega === 'envio' ? 'envio' : 'pickup';
  if (tipoEntrega === 'envio' && (!cli.direccion || !String(cli.direccion).trim())) {
    return { error: 'La dirección es obligatoria para envío a domicilio' };
  }
  const itemsNorm = listaItems.map((it) => ({
    id: Number(it.id),
    nombre: String(it.nombre || 'Producto'),
    precio: redondear2(it.precio) || 0,
    cantidad: Number(it.cantidad) || 0,
    costo: it.costo != null ? Number(it.costo) : 0,
    esGranel: Boolean(it.esGranel),
    imagen: it.imagen || '',
  })).filter((it) => it.cantidad > 0);
  if (itemsNorm.length === 0) return { error: 'El pedido no tiene productos válidos' };
  const subtotal = redondear2(itemsNorm.reduce((s, it) => s + it.precio * it.cantidad, 0));
  const costoEnvio = tipoEntrega === 'envio' ? (redondear2(envio) || 0) : 0;
  const total = redondear2(subtotal + costoEnvio);
  let estadoPago = 'pendiente';
  if (metodoPago === 'transferencia') estadoPago = 'en_revision';
  return {
    itemsNorm,
    tipoEntrega,
    metodoPago,
    estadoPago,
    subtotal,
    costoEnvio,
    total,
    notas: notas ? String(notas) : '',
    cliente: {
      nombre: String(cli.nombre).trim(),
      telefono: String(cli.telefono).trim(),
      email: cli.email ? String(cli.email).trim() : '',
      direccion: cli.direccion ? String(cli.direccion).trim() : '',
      referencias: cli.referencias ? String(cli.referencias).trim() : '',
    },
  };
}

function pedidoSePuedeEditar(pedido) {
  if (!pedido) return false;
  if (pedido.estadoPago === 'pagado' || pedido.estadoPago === 'rechazado') return false;
  if (pedido.estadoPedido === 'cancelado' || pedido.estadoPedido === 'entregado' || pedido.estadoPedido === 'listo') return false;
  if (pedido.stockDescontado) return false;
  return true;
}

// Crear pedido desde el carrito de la web
router.post('/', async (req, res) => {
  try {
    const datos = parseCheckoutBody(req.body);
    if (datos.error) return res.status(400).json({ error: datos.error });
    const id = await getNextId(Pedido);
    const pedido = await Pedido.create({
      id,
      fecha: ahora(),
      items: datos.itemsNorm,
      subtotal: datos.subtotal,
      envio: datos.costoEnvio,
      total: datos.total,
      cliente: datos.cliente,
      entrega: datos.tipoEntrega,
      metodoPago: datos.metodoPago,
      estadoPago: datos.estadoPago,
      estadoPedido: 'nuevo',
      notas: datos.notas,
      creadoEn: ahora(),
      actualizadoEn: ahora(),
    });
    notificarPedidoTransferencia(pedido.toObject());
    res.status(201).json(pedido.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// El cliente vuelve atrás y cambia datos o método de pago (mismo pedido)
router.put('/:id/checkout', async (req, res) => {
  try {
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (!pedidoSePuedeEditar(pedido)) {
      return res.status(400).json({ error: 'Este pedido ya no se puede modificar' });
    }
    const datos = parseCheckoutBody(req.body);
    if (datos.error) return res.status(400).json({ error: datos.error });
    const cambioATransferencia = pedido.metodoPago !== 'transferencia' && datos.metodoPago === 'transferencia';
    pedido.items = datos.itemsNorm;
    pedido.subtotal = datos.subtotal;
    pedido.envio = datos.costoEnvio;
    pedido.total = datos.total;
    pedido.cliente = datos.cliente;
    pedido.entrega = datos.tipoEntrega;
    pedido.metodoPago = datos.metodoPago;
    pedido.estadoPago = datos.estadoPago;
    pedido.notas = datos.notas;
    if (datos.metodoPago !== 'transferencia') pedido.comprobante = '';
    pedido.actualizadoEn = ahora();
    await pedido.save();
    if (cambioATransferencia) notificarPedidoTransferencia(pedido.toObject());
    res.json(pedido.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// El cliente sube el comprobante de la transferencia (imagen base64 o URL)
router.post('/:id/comprobante', async (req, res) => {
  try {
    const { comprobante } = req.body;
    if (!comprobante) return res.status(400).json({ error: 'Falta el comprobante' });
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    pedido.comprobante = String(comprobante);
    if (pedido.metodoPago === 'transferencia' && pedido.estadoPago !== 'pagado') {
      pedido.estadoPago = 'en_revision';
    }
    pedido.actualizadoEn = ahora();
    await pedido.save();
    notificarComprobante(pedido.toObject());
    res.json(pedido.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: confirma que el pago cayó -> arma el pedido y descuenta stock
router.put('/:id/verificar', async (req, res) => {
  try {
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estadoPago === 'rechazado') {
      return res.status(400).json({ error: 'El pedido fue rechazado; no se puede confirmar' });
    }
    const yaPagado = pedido.estadoPago === 'pagado';
    pedido.estadoPago = 'pagado';
    if (pedido.estadoPedido === 'nuevo' || pedido.estadoPedido === 'cancelado') {
      pedido.estadoPedido = 'confirmado';
    }
    await descontarStockPedido(pedido);
    pedido.actualizadoEn = ahora();
    await pedido.save();
    if (!yaPagado) notificarPagoConfirmado(pedido.toObject());
    res.json(pedido.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: rechaza el pago (no cayó el depósito) -> se omite el pedido
router.put('/:id/rechazar', async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    const yaRechazado = pedido.estadoPago === 'rechazado';
    pedido.estadoPago = 'rechazado';
    pedido.estadoPedido = 'cancelado';
    if (motivo) pedido.notas = `${pedido.notas ? pedido.notas + ' | ' : ''}Rechazado: ${motivo}`;
    pedido.actualizadoEn = ahora();
    await pedido.save();
    if (!yaRechazado) notificarPagoRechazado(pedido.toObject(), motivo);
    res.json(pedido.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: actualizar estado logístico del pedido
router.put('/:id/estado', async (req, res) => {
  try {
    const { estadoPedido } = req.body || {};
    const validos = ['nuevo', 'confirmado', 'preparando', 'listo', 'entregado', 'cancelado'];
    if (!validos.includes(estadoPedido)) {
      return res.status(400).json({ error: 'Estado de pedido inválido' });
    }
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    pedido.estadoPedido = estadoPedido;
    pedido.actualizadoEn = ahora();
    await pedido.save();
    res.json(pedido.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await Pedido.deleteOne({ id: Number(req.params.id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
