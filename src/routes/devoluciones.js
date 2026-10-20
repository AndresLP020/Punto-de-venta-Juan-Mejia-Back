import { Router } from 'express';
import { getNextId } from '../db.js';
import { Devolucion } from '../models/Devolucion.js';
import { Producto } from '../models/Producto.js';
import { Venta } from '../models/Venta.js';
import { aplicarStock, netoCobrado, recalcularEstado } from './ventas.js';
import { HttpError, numero, redondear2, serverError, texto } from '../utils.js';

const router = Router();
const redondearCantidad = (n) => Math.round(Number(n) * 1000) / 1000;

router.get('/', async (req, res) => {
  try {
    const devoluciones = await Devolucion.find().sort({ id: -1 }).lean();
    res.json(devoluciones);
  } catch (err) {
    serverError(res, err);
  }
});

/** Lista aplanada de ítems con tipo "perdida" para el apartado de pérdidas */
router.get('/perdidas', async (req, res) => {
  try {
    const devoluciones = await Devolucion.find({ 'items.tipo': 'perdida' }).sort({ id: -1 }).lean();
    const perdidas = [];
    for (const d of devoluciones) {
      for (const it of d.items || []) {
        if (it.tipo === 'perdida') {
          perdidas.push({
            id: d.id,
            fecha: d.fecha,
            ventaId: d.ventaId,
            productoId: it.productoId,
            nombre: it.nombre,
            cantidad: it.cantidad,
            precio: it.precio,
            costo: it.costo ?? 0,
            valorPerdida: redondear2(it.cantidad * it.precio),
            costoPerdida: redondear2(it.cantidad * (it.costo ?? 0)),
          });
        }
      }
    }
    res.json(perdidas);
  } catch (err) {
    serverError(res, err);
  }
});

/**
 * Cantidades devueltas por producto en devoluciones antiguas de una venta. Las devoluciones
 * nuevas ya descuentan las cantidades del ticket (aplicadaAVenta), así que no se cuentan aquí.
 */
async function devueltoPorProducto(ventaId) {
  const previas = await Devolucion.find({ ventaId, aplicadaAVenta: { $ne: true } }).lean();
  const m = new Map();
  for (const d of previas) for (const it of d.items || []) m.set(it.productoId, (m.get(it.productoId) || 0) + it.cantidad);
  return m;
}

router.post('/', async (req, res) => {
  try {
    const { ventaId, items } = req.body || {};
    const ventaIdNum = ventaId != null && ventaId !== '' ? Number(ventaId) : 0;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un ítem' });
    }
    const itemsValidados = items
      .filter((it) => it.id != null && numero(it.cantidad) > 0 && ['revendible', 'perdida'].includes(it.tipo))
      .map((it) => ({
        productoId: Number(it.id),
        nombre: texto(it.nombre, 200),
        cantidad: redondearCantidad(it.cantidad),
        precio: Math.max(0, redondear2(numero(it.precio))),
        costo: 0,
        tipo: it.tipo === 'perdida' ? 'perdida' : 'revendible',
      }));
    if (itemsValidados.length === 0) {
      return res.status(400).json({ error: 'Ningún ítem válido (cantidad > 0 y tipo revendible o perdida)' });
    }

    let venta = null;
    if (ventaIdNum) {
      venta = await Venta.findOne({ id: ventaIdNum });
      if (!venta) throw new HttpError(404, 'Venta no encontrada');
      if (venta.estado === 'cancelada') throw new HttpError(400, 'La venta está cancelada');
      // Solo se puede devolver lo que se vendió en ese ticket; precio y costo salen del ticket.
      const devuelto = await devueltoPorProducto(ventaIdNum);
      for (const it of itemsValidados) {
        const vendidos = (venta.items || []).filter((v) => Number(v.id) === it.productoId);
        const cantidadVendida = vendidos.reduce((s, v) => s + (Number(v.cantidad) || 0), 0);
        if (vendidos.length === 0) throw new HttpError(400, `"${it.nombre || it.productoId}" no está en la venta #${ventaIdNum}`);
        const yaDevuelto = devuelto.get(it.productoId) || 0;
        const disponible = Math.max(0, redondearCantidad(cantidadVendida - yaDevuelto));
        if (it.cantidad > disponible + 0.0005) {
          throw new HttpError(400, `Solo quedan ${disponible} de "${vendidos[0].nombre}" en la venta #${ventaIdNum} para devolver`);
        }
        it.nombre = vendidos[0].nombre;
        it.precio = numero(vendidos[0].precio);
        it.costo = numero(vendidos[0].costo);
      }
    } else {
      const productos = await Producto.find({ id: { $in: itemsValidados.map((i) => i.productoId) } }).lean();
      const porId = new Map(productos.map((p) => [p.id, p]));
      for (const it of itemsValidados) {
        const prod = porId.get(it.productoId);
        if (!prod) throw new HttpError(400, `El producto "${it.nombre || it.productoId}" no existe`);
        it.nombre = prod.nombre;
        it.costo = numero(prod.costo);
      }
    }

    // Lo revendible regresa al inventario.
    const deltas = {};
    for (const it of itemsValidados) {
      if (it.tipo === 'revendible' && (await Producto.exists({ id: it.productoId }))) {
        deltas[it.productoId] = (deltas[it.productoId] || 0) + it.cantidad;
      }
    }
    const aplicados = await aplicarStock(deltas);

    try {
      const fechaIso = new Date().toISOString();
      const valor = redondear2(itemsValidados.reduce((s, it) => s + it.cantidad * it.precio, 0));
      let reembolso = valor;
      let ajusteCosto;

      if (venta) {
        // Se quitan del ticket las cantidades devueltas; el costo de lo perdido se registra en la devolución.
        const items = venta.items.map((v) => (v.toObject ? v.toObject() : v));
        for (const it of itemsValidados) {
          let restante = it.cantidad;
          for (const v of items) {
            if (Number(v.id) !== it.productoId || restante <= 0) continue;
            const quitar = Math.min(v.cantidad, restante);
            v.cantidad = redondearCantidad(v.cantidad - quitar);
            restante = redondearCantidad(restante - quitar);
          }
        }
        venta.items = items.filter((v) => v.cantidad > 0);
        venta.total = redondear2(venta.items.reduce((s, v) => s + v.precio * v.cantidad, 0));
        reembolso = Math.max(0, redondear2(netoCobrado(venta) - venta.total));
        if (reembolso > 0) venta.reembolsos.push({ fecha: fechaIso, monto: reembolso, motivo: 'Devolución' });
        if (venta.items.length === 0) {
          venta.estado = 'cancelada';
          venta.fechaCancelacion = fechaIso;
        }
        recalcularEstado(venta);
        ajusteCosto = redondear2(itemsValidados.filter((i) => i.tipo === 'perdida').reduce((s, i) => s + i.cantidad * i.costo, 0));
      } else {
        ajusteCosto = -redondear2(itemsValidados.filter((i) => i.tipo === 'revendible').reduce((s, i) => s + i.cantidad * i.costo, 0));
      }

      const id = await getNextId(Devolucion);
      await Devolucion.create({ id, fecha: fechaIso, ventaId: ventaIdNum, items: itemsValidados, reembolso, ajusteCosto, aplicadaAVenta: Boolean(venta) });
      if (venta) await venta.save();
      const creada = await Devolucion.findOne({ id }).lean();
      res.status(201).json(creada);
    } catch (err) {
      for (const [pid, d] of aplicados) await Producto.updateOne({ id: pid }, { $inc: { stock: -d } }).catch(() => {});
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
