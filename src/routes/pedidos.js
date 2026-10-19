import { Router } from 'express';
import { getNextId } from '../db.js';
import { Pedido } from '../models/Pedido.js';
import { Producto } from '../models/Producto.js';
import { ConfigPago } from '../models/ConfigPago.js';
import {
  notificarPedidoTransferencia,
  notificarComprobante,
  notificarPagoConfirmado,
  notificarPagoRechazado,
} from '../notificaciones.js';
import { requiereAdmin, requiereSesion, sesionDe, tokenPedido } from '../seguridad.js';

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

// Regresa al inventario lo descontado (pedido cancelado, rechazado o borrado).
export async function restaurarStockPedido(pedido) {
  if (!pedido || !pedido.stockDescontado) return;
  for (const it of pedido.items || []) {
    if (it.id != null && Number(it.cantidad) > 0) {
      await Producto.findOneAndUpdate({ id: it.id }, { $inc: { stock: Number(it.cantidad) } });
    }
  }
  pedido.stockDescontado = false;
}

// El personal con sesión ve cualquier pedido; el cliente necesita el token de su enlace.
// Los pedidos anteriores a los tokens (sin token) siguen abiertos.
export function puedeVerPedido(req, pedido) {
  if (!pedido) return false;
  if (!pedido.token) return true;
  if (sesionDe(req)) return true;
  const t = req.query?.t || req.body?.t || req.headers['x-pedido-token'];
  return t === pedido.token;
}

// GET /api/pedidos?estadoPago=&estadoPedido=&metodoPago=
router.get('/', requiereSesion, async (req, res) => {
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
    if (!req.sesion.admin) return res.status(403).json({ error: 'Requiere modo administrador' });
    const pedidos = await Pedido.find(query).sort({ id: -1 }).lean();
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await Pedido.findOne({ id: Number(req.params.id) }).lean();
    if (!puedeVerPedido(req, p)) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Valida el checkout. Precios, nombres y costo de envío se toman de la base de datos,
// nunca de lo que manda el navegador.
async function parseCheckoutBody(body) {
  const { items, cliente, entrega, metodoPago, notas } = body || {};
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

  // Une cantidades repetidas del mismo producto
  const cantidades = new Map();
  for (const it of listaItems) {
    const id = Number(it.id);
    const cant = Number(it.cantidad) || 0;
    if (!Number.isFinite(id) || cant <= 0) continue;
    cantidades.set(id, (cantidades.get(id) || 0) + cant);
  }
  if (cantidades.size === 0) return { error: 'El pedido no tiene productos válidos' };

  const productos = await Producto.find({ id: { $in: [...cantidades.keys()] } }).lean();
  const porId = new Map(productos.map((p) => [p.id, p]));
  const itemsNorm = [];
  for (const [id, cantPedida] of cantidades) {
    const prod = porId.get(id);
    if (!prod || prod.estado === 'Inactivo') {
      return { error: 'Uno de los productos ya no está disponible. Actualiza tu carrito.' };
    }
    const cantidad = prod.esGranel ? Math.round(cantPedida * 1000) / 1000 : Math.max(1, Math.round(cantPedida));
    const stock = Number(prod.stock) || 0;
    if (cantidad > stock) {
      return { error: stock > 0 ? `Solo quedan ${stock} de "${prod.nombre}".` : `"${prod.nombre}" está agotado.` };
    }
    itemsNorm.push({
      id: prod.id,
      nombre: prod.nombre || 'Producto',
      precio: redondear2(prod.precio) || 0,
      cantidad,
      costo: Number(prod.costo) || 0,
      esGranel: Boolean(prod.esGranel),
      imagen: prod.imagen && !String(prod.imagen).startsWith('data:') ? prod.imagen : '',
    });
  }
  const subtotal = redondear2(itemsNorm.reduce((s, it) => s + it.precio * it.cantidad, 0));
  let costoEnvio = 0;
  if (tipoEntrega === 'envio') {
    const cfg = await ConfigPago.findOne({ clave: 'pagos' }).lean();
    costoEnvio = redondear2(cfg?.costoEnvio != null ? cfg.costoEnvio : 10) || 0;
  }
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
    notas: notas ? String(notas).slice(0, 1000) : '',
    cliente: {
      nombre: String(cli.nombre).trim().slice(0, 120),
      telefono: String(cli.telefono).trim().slice(0, 40),
      email: cli.email ? String(cli.email).trim().slice(0, 120) : '',
      direccion: cli.direccion ? String(cli.direccion).trim().slice(0, 300) : '',
      referencias: cli.referencias ? String(cli.referencias).trim().slice(0, 300) : '',
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
    const datos = await parseCheckoutBody(req.body);
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
      token: tokenPedido(),
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
    if (!puedeVerPedido(req, pedido)) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (!pedidoSePuedeEditar(pedido)) {
      return res.status(400).json({ error: 'Este pedido ya no se puede modificar' });
    }
    const datos = await parseCheckoutBody(req.body);
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
    const texto = String(comprobante);
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(texto) && !/^https?:\/\//i.test(texto)) {
      return res.status(400).json({ error: 'El comprobante debe ser una imagen' });
    }
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!puedeVerPedido(req, pedido)) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estadoPago === 'pagado' || pedido.estadoPago === 'rechazado') {
      return res.status(400).json({ error: 'Este pedido ya no admite comprobantes' });
    }
    pedido.comprobante = texto;
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
router.put('/:id/verificar', requiereAdmin, async (req, res) => {
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
router.put('/:id/rechazar', requiereAdmin, async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    const yaRechazado = pedido.estadoPago === 'rechazado';
    pedido.estadoPago = 'rechazado';
    pedido.estadoPedido = 'cancelado';
    await restaurarStockPedido(pedido);
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
router.put('/:id/estado', requiereAdmin, async (req, res) => {
  try {
    const { estadoPedido } = req.body || {};
    const validos = ['nuevo', 'confirmado', 'preparando', 'listo', 'entregado', 'cancelado'];
    if (!validos.includes(estadoPedido)) {
      return res.status(400).json({ error: 'Estado de pedido inválido' });
    }
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (estadoPedido === 'cancelado') {
      await restaurarStockPedido(pedido);
    } else if (pedido.estadoPago === 'pagado') {
      await descontarStockPedido(pedido); // se reactiva un pedido pagado que estaba cancelado
    }
    pedido.estadoPedido = estadoPedido;
    pedido.actualizadoEn = ahora();
    await pedido.save();
    res.json(pedido.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requiereAdmin, async (req, res) => {
  try {
    const pedido = await Pedido.findOne({ id: Number(req.params.id) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    await restaurarStockPedido(pedido);
    await Pedido.deleteOne({ id: pedido.id });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
