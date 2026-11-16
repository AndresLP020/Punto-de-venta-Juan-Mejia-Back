import { Router } from 'express';
import { getNextId } from '../db.js';
import { Pedido } from '../models/Pedido.js';
import { Venta } from '../models/Venta.js';
import { Producto } from '../models/Producto.js';
import { Cliente } from '../models/Cliente.js';
import { requirePermiso, tienePermiso } from '../auth.js';
import { HttpError, numero, redondear2, serverError, texto } from '../utils.js';
import { aplicarStock, recalcularEstado, revertirStock, validarItems } from './ventas.js';

const router = Router();
const ESTADOS = ['por_pagar', 'pagado', 'entregado', 'cancelado'];

/** Lo que el cliente ya debía antes de este pedido (ventas a crédito con saldo, igual que en Deudores). */
export async function saldoDeCliente(clienteId) {
  if (clienteId == null) return null;
  const [r] = await Venta.aggregate([
    { $match: { clienteId: Number(clienteId), estado: 'pendiente', pendiente: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: '$pendiente' } } },
  ]);
  return redondear2(r?.total || 0);
}

const quien = (req) => ({ login: req.sesion?.sub, nombre: texto(req.sesion?.nombre || req.sesion?.sub, 120) });

router.get('/', async (req, res) => {
  try {
    const filtro = {};
    const estados = String(req.query.estado || '')
      .split(',')
      .filter((e) => ESTADOS.includes(e));
    if (estados.length) filtro.estado = { $in: estados };
    if (req.query.desde) filtro.fecha = { $gte: new Date(String(req.query.desde)).toISOString() };
    const limite = Math.min(Number(req.query.limite) || 200, 1000);
    res.json(await Pedido.find(filtro).sort({ id: -1 }).limit(limite).lean());
  } catch (err) {
    if (err instanceof RangeError) return res.status(400).json({ error: 'Fecha inválida' });
    serverError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await Pedido.findOne({ id: Number(req.params.id) }).lean();
    if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(p);
  } catch (err) {
    serverError(res, err);
  }
});

/** Tomar pedido: aparta los productos del inventario y queda pendiente de pago en caja. */
router.post('/', requirePermiso('hacerVentas'), async (req, res) => {
  try {
    const { items, cliente, clienteId } = req.body || {};
    const itemsPedido = validarItems(items);
    const ids = [...new Set(itemsPedido.map((it) => it.id))];
    const productos = await Producto.find({ id: { $in: ids } }).lean();
    const porId = new Map(productos.map((p) => [p.id, p]));
    for (const it of itemsPedido) {
      const prod = porId.get(it.id);
      if (!prod) throw new HttpError(400, `El producto "${it.nombre}" no existe`);
      if ((prod.estado || 'Activo') !== 'Activo') throw new HttpError(400, `El producto "${prod.nombre}" está dado de baja`);
      it.nombre = prod.nombre;
      it.costo = numero(prod.costo);
    }
    let clienteDoc = null;
    if (clienteId) {
      clienteDoc = await Cliente.findOne({ id: Number(clienteId) }).lean();
      if (!clienteDoc) throw new HttpError(400, 'El cliente seleccionado no existe');
    }

    const deltas = {};
    for (const it of itemsPedido) deltas[it.id] = (deltas[it.id] || 0) - it.cantidad;
    const aplicados = await aplicarStock(deltas);
    try {
      const yo = quien(req);
      const pedido = await Pedido.create({
        id: await getNextId(Pedido),
        fecha: new Date().toISOString(),
        items: itemsPedido,
        total: redondear2(itemsPedido.reduce((s, it) => s + it.precio * it.cantidad, 0)),
        cliente: clienteDoc?.nombre || texto(cliente, 120),
        clienteId: clienteDoc?.id ?? null,
        estado: 'por_pagar',
        usuario: yo.login,
        usuarioNombre: yo.nombre,
      });
      // Para imprimir en el ticket el total de la cuenta del cliente.
      const saldoCliente = await saldoDeCliente(pedido.clienteId).catch(() => null);
      res.status(201).json({ ...pedido.toObject(), saldoCliente });
    } catch (err) {
      await revertirStock(aplicados);
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

/**
 * Cobrar en caja: registra la venta (sin volver a descontar inventario, ya estaba apartado).
 * Acepta pago parcial con cliente, igual que una venta a crédito.
 */
router.post('/:id/pagar', requirePermiso('cobrarEnCaja'), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const actual = await Pedido.findOne({ id }).lean();
    if (!actual) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (actual.estado !== 'por_pagar') {
      return res.status(400).json({ error: actual.estado === 'cancelado' ? 'El pedido está cancelado' : 'Este pedido ya fue pagado' });
    }
    const { pagado, clienteId } = req.body || {};
    const total = redondear2(actual.total);
    const recibido = pagado == null || pagado === '' ? total : numero(pagado, NaN);
    if (!Number.isFinite(recibido) || recibido < 0) throw new HttpError(400, 'El monto pagado no es válido');
    const pagadoVenta = redondear2(Math.min(recibido, total));

    const idCliente = clienteId ?? actual.clienteId;
    let clienteDoc = null;
    if (idCliente) {
      clienteDoc = await Cliente.findOne({ id: Number(idCliente) }).lean();
      if (!clienteDoc) throw new HttpError(400, 'El cliente seleccionado no existe');
    }
    if (pagadoVenta < total && !clienteDoc) {
      throw new HttpError(400, 'Para dejar saldo pendiente (venta a crédito) selecciona un cliente');
    }

    // Marcar como pagado de forma atómica: si dos cajas cobran a la vez, solo una gana.
    const yo = quien(req);
    const ahora = new Date().toISOString();
    const tomado = await Pedido.findOneAndUpdate(
      { id, estado: 'por_pagar' },
      { $set: { estado: 'pagado', cajero: yo.login, cajeroNombre: yo.nombre, fechaPago: ahora } },
      { new: true }
    );
    if (!tomado) return res.status(409).json({ error: 'Otra caja acaba de cobrar o cancelar este pedido' });

    try {
      const venta = new Venta({
        id: await getNextId(Venta),
        fecha: ahora,
        items: actual.items,
        total,
        pagado: pagadoVenta,
        cliente: clienteDoc?.nombre || actual.cliente || '',
        clienteId: clienteDoc?.id ?? null,
        abonos: [],
        reembolsos: [],
        // La venta queda a nombre de quien tomó el pedido (es quien atendió al cliente).
        usuario: actual.usuario,
        usuarioNombre: actual.usuarioNombre,
        pedidoId: id,
      });
      recalcularEstado(venta);
      await venta.save();
      tomado.ventaId = venta.id;
      if (clienteDoc) {
        tomado.cliente = clienteDoc.nombre;
        tomado.clienteId = clienteDoc.id;
      }
      await tomado.save();
      res.json({ pedido: tomado.toObject(), venta: venta.toObject(), cambio: redondear2(recibido - pagadoVenta) });
    } catch (err) {
      await Pedido.updateOne({ id }, { $set: { estado: 'por_pagar' }, $unset: { cajero: 1, cajeroNombre: 1, fechaPago: 1 } });
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

/** Entregar: quien atiende confirma que ya se pagó y entrega la mercancía. */
router.post('/:id/entregar', requirePermiso('hacerVentas'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const yo = quien(req);
    const p = await Pedido.findOneAndUpdate(
      { id, estado: 'pagado' },
      { $set: { estado: 'entregado', entregadoPor: yo.login, entregadoPorNombre: yo.nombre, fechaEntrega: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!p) {
      const actual = await Pedido.findOne({ id }).lean();
      if (!actual) return res.status(404).json({ error: 'Pedido no encontrado' });
      const motivo = {
        por_pagar: 'Todavía no se ha pagado en caja: no se puede entregar',
        entregado: 'Este pedido ya fue entregado',
        cancelado: 'El pedido está cancelado',
      }[actual.estado];
      return res.status(400).json({ error: motivo || 'No se puede entregar este pedido' });
    }
    res.json(p);
  } catch (err) {
    serverError(res, err);
  }
});

/** Cancelar un pedido que no se pagó: regresa los productos al inventario. */
router.post('/:id/cancelar', async (req, res) => {
  try {
    if (!tienePermiso(req.sesion, 'hacerVentas') && !tienePermiso(req.sesion, 'cobrarEnCaja')) {
      return res.status(403).json({ error: 'No tienes permiso para cancelar pedidos' });
    }
    const id = Number(req.params.id);
    const ahora = new Date().toISOString();
    const p = await Pedido.findOneAndUpdate(
      { id, estado: 'por_pagar' },
      { $set: { estado: 'cancelado', fechaCancelacion: ahora, canceladoPor: quien(req).nombre } },
      { new: true }
    );
    if (!p) {
      const actual = await Pedido.findOne({ id }).lean();
      if (!actual) return res.status(404).json({ error: 'Pedido no encontrado' });
      return res.status(400).json({
        error: actual.estado === 'cancelado' ? 'El pedido ya estaba cancelado' : 'Un pedido pagado no se cancela aquí: cancela la venta en Historial',
      });
    }
    const deltas = {};
    for (const it of p.items || []) {
      if (it.id != null && (await Producto.exists({ id: it.id }))) deltas[it.id] = (deltas[it.id] || 0) + (Number(it.cantidad) || 0);
    }
    try {
      await aplicarStock(deltas);
    } catch (err) {
      await Pedido.updateOne({ id }, { $set: { estado: 'por_pagar' }, $unset: { fechaCancelacion: 1, canceladoPor: 1 } });
      throw err;
    }
    res.json(p.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
