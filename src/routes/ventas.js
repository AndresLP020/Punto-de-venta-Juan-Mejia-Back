import { Router } from 'express';
import { getNextId } from '../db.js';
import { Venta } from '../models/Venta.js';
import { Producto } from '../models/Producto.js';
import { Cliente } from '../models/Cliente.js';
import { requireAdmin, requirePermiso } from '../auth.js';
import { HttpError, numero, redondear2, serverError, texto } from '../utils.js';

const router = Router();

const redondearCantidad = (n) => Math.round(Number(n) * 1000) / 1000;
const suma = (arr) => (arr || []).reduce((s, m) => s + (Number(m.monto) || 0), 0);

/** Dinero que el negocio conserva de la venta (lo cobrado menos lo devuelto). */
export function netoCobrado(venta) {
  return redondear2((Number(venta.pagado) || 0) - suma(venta.reembolsos));
}

function recalcularEstado(venta) {
  if (venta.estado === 'cancelada') {
    venta.pendiente = 0;
    return;
  }
  venta.pendiente = redondear2(Math.max(0, (Number(venta.total) || 0) - netoCobrado(venta)));
  venta.estado = venta.pendiente <= 0 ? 'pagado' : 'pendiente';
}

function validarItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'La venta debe tener al menos un producto');
  return raw.map((it) => {
    const id = Number(it.id);
    const cantidad = redondearCantidad(it.cantidad);
    const precio = redondear2(it.precio);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Producto inválido en la venta');
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw new HttpError(400, `Cantidad inválida para "${texto(it.nombre, 80)}"`);
    if (!Number.isFinite(precio) || precio < 0) throw new HttpError(400, `Precio inválido para "${texto(it.nombre, 80)}"`);
    return { id, nombre: texto(it.nombre, 200), precio, cantidad, costo: it.costo };
  });
}

/**
 * Aplica cambios de inventario { productoId: delta } (delta negativo = sale del inventario).
 * Cada descuento es atómico y solo ocurre si hay stock suficiente; si alguno falla
 * se revierten los que ya se aplicaron.
 */
async function aplicarStock(deltas, nombres = {}) {
  const aplicados = [];
  try {
    for (const [idStr, delta] of Object.entries(deltas)) {
      const id = Number(idStr);
      const d = redondearCantidad(delta);
      if (!d) continue;
      if (d < 0) {
        const ok = await Producto.findOneAndUpdate({ id, stock: { $gte: -d } }, { $inc: { stock: d } });
        if (!ok) {
          const prod = await Producto.findOne({ id }).lean();
          const nombre = prod?.nombre || nombres[id] || `#${id}`;
          if (!prod) throw new HttpError(400, `El producto "${nombre}" ya no existe`);
          throw new HttpError(400, `No hay stock suficiente para "${nombre}". Disponible: ${prod.stock ?? 0}, solicitado: ${-d}`);
        }
      } else {
        await Producto.updateOne({ id }, { $inc: { stock: d } });
      }
      aplicados.push([id, d]);
    }
  } catch (err) {
    for (const [id, d] of aplicados.reverse()) {
      await Producto.updateOne({ id }, { $inc: { stock: -d } }).catch((e) => console.error('No se pudo revertir stock', id, e));
    }
    throw err;
  }
  return aplicados;
}

async function revertirStock(aplicados) {
  for (const [id, d] of aplicados) {
    await Producto.updateOne({ id }, { $inc: { stock: -d } }).catch((e) => console.error('No se pudo revertir stock', id, e));
  }
}

router.get('/', async (req, res) => {
  try {
    const filtro = {};
    if (req.query.desde || req.query.hasta) {
      filtro.fecha = {};
      if (req.query.desde) filtro.fecha.$gte = new Date(String(req.query.desde)).toISOString();
      if (req.query.hasta) filtro.fecha.$lte = new Date(String(req.query.hasta)).toISOString();
    }
    if (req.query.clienteId) filtro.clienteId = Number(req.query.clienteId);
    if (req.query.estado) filtro.estado = String(req.query.estado);
    let consulta = Venta.find(filtro).sort({ id: -1 });
    const limite = Number(req.query.limite);
    if (Number.isInteger(limite) && limite > 0) consulta = consulta.limit(Math.min(limite, 1000));
    res.json(await consulta.lean());
  } catch (err) {
    if (err instanceof RangeError) return res.status(400).json({ error: 'Fecha inválida' });
    serverError(res, err);
  }
});

router.post('/', requirePermiso('hacerVentas'), async (req, res) => {
  try {
    const { items, cliente, clienteId, pagado } = req.body || {};
    const itemsVenta = validarItems(items);

    // El costo y la disponibilidad se toman siempre de la base de datos, no del navegador.
    const ids = [...new Set(itemsVenta.map((it) => it.id))];
    const productos = await Producto.find({ id: { $in: ids } }).lean();
    const porId = new Map(productos.map((p) => [p.id, p]));
    for (const it of itemsVenta) {
      const prod = porId.get(it.id);
      if (!prod) throw new HttpError(400, `El producto "${it.nombre}" no existe`);
      if ((prod.estado || 'Activo') !== 'Activo') throw new HttpError(400, `El producto "${prod.nombre}" está dado de baja`);
      it.nombre = prod.nombre;
      it.costo = numero(prod.costo);
    }

    const total = redondear2(itemsVenta.reduce((s, it) => s + it.precio * it.cantidad, 0));
    const recibido = pagado == null || pagado === '' ? total : numero(pagado, NaN);
    if (!Number.isFinite(recibido) || recibido < 0) throw new HttpError(400, 'El monto pagado no es válido');
    // Lo que excede el total es cambio entregado al cliente: no es dinero del negocio.
    const pagadoVenta = redondear2(Math.min(recibido, total));

    let clienteDoc = null;
    if (clienteId) {
      clienteDoc = await Cliente.findOne({ id: Number(clienteId) }).lean();
      if (!clienteDoc) throw new HttpError(400, 'El cliente seleccionado no existe');
    }
    if (pagadoVenta < total && !clienteDoc) {
      throw new HttpError(400, 'Para una venta a crédito (pago incompleto) debes seleccionar un cliente');
    }

    const deltas = {};
    for (const it of itemsVenta) deltas[it.id] = (deltas[it.id] || 0) - it.cantidad;
    const aplicados = await aplicarStock(deltas);

    try {
      const id = await getNextId(Venta);
      const venta = new Venta({
        id,
        fecha: new Date().toISOString(),
        items: itemsVenta,
        total,
        pagado: pagadoVenta,
        cliente: clienteDoc?.nombre || texto(cliente, 120),
        clienteId: clienteDoc?.id ?? null,
        abonos: [],
        reembolsos: [],
        usuario: req.sesion?.sub,
        usuarioNombre: texto(req.sesion?.nombre || req.sesion?.sub, 120),
      });
      recalcularEstado(venta);
      await venta.save();
      res.status(201).json({ ...venta.toObject(), cambio: redondear2(recibido - pagadoVenta) });
    } catch (err) {
      await revertirStock(aplicados);
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

// Editar ticket: modificar items (precio, cantidad), agregar o quitar productos. Ajusta inventario y recalcula total.
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const venta = await Venta.findOne({ id: Number(req.params.id) });
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
    if (venta.estado === 'cancelada') return res.status(400).json({ error: 'No se puede editar una venta cancelada' });

    const itemsNuevos = validarItems(req.body?.items);
    const itemsViejos = venta.items || [];

    const costoPrevio = new Map(itemsViejos.map((it) => [Number(it.id), it.costo]));
    const ids = [...new Set(itemsNuevos.map((it) => it.id))];
    const productos = await Producto.find({ id: { $in: ids } }).lean();
    const porId = new Map(productos.map((p) => [p.id, p]));
    for (const it of itemsNuevos) {
      const prod = porId.get(it.id);
      if (!prod && !costoPrevio.has(it.id)) throw new HttpError(400, `El producto "${it.nombre}" no existe`);
      // Conservar el costo histórico de lo que ya estaba en el ticket; lo nuevo toma el costo actual.
      it.costo = costoPrevio.has(it.id) ? numero(costoPrevio.get(it.id)) : numero(prod?.costo);
      if (!it.nombre) it.nombre = prod?.nombre || 'Producto';
    }

    // Solo se mueve en inventario la diferencia entre el ticket original y el nuevo.
    const deltas = {};
    for (const it of itemsViejos) if (it.id != null) deltas[it.id] = (deltas[it.id] || 0) + (Number(it.cantidad) || 0);
    for (const it of itemsNuevos) deltas[it.id] = (deltas[it.id] || 0) - it.cantidad;
    for (const id of Object.keys(deltas)) {
      if (deltas[id] > 0 && !(await Producto.exists({ id: Number(id) }))) delete deltas[id];
    }
    const aplicados = await aplicarStock(deltas);

    try {
      venta.items = itemsNuevos;
      venta.total = redondear2(itemsNuevos.reduce((s, it) => s + it.precio * it.cantidad, 0));
      const excedente = redondear2(netoCobrado(venta) - venta.total);
      if (excedente > 0) {
        venta.reembolsos.push({ fecha: new Date().toISOString(), monto: excedente, motivo: 'Corrección de ticket' });
      }
      recalcularEstado(venta);
      await venta.save();
      res.json({ ...venta.toObject(), reembolso: Math.max(0, excedente) });
    } catch (err) {
      await revertirStock(aplicados);
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/:id/abonar', async (req, res) => {
  try {
    const monto = redondear2(req.body?.monto);
    if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El monto del abono debe ser mayor a 0' });
    const venta = await Venta.findOne({ id: Number(req.params.id) });
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
    if (venta.estado === 'cancelada') return res.status(400).json({ error: 'La venta está cancelada' });
    recalcularEstado(venta);
    if (venta.pendiente <= 0) return res.status(400).json({ error: 'Esta venta ya está pagada' });
    if (monto > venta.pendiente + 0.001) {
      return res.status(400).json({ error: `El abono no puede ser mayor al pendiente ($${venta.pendiente.toFixed(2)})` });
    }
    venta.abonos.push({ fecha: new Date().toISOString(), monto });
    venta.pagado = redondear2((Number(venta.pagado) || 0) + monto);
    recalcularEstado(venta);
    await venta.save();
    res.json(venta.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

// Cancelar venta: regresa los productos al inventario y registra la devolución del dinero cobrado.
router.post('/:id/cancelar', requireAdmin, async (req, res) => {
  try {
    const venta = await Venta.findOne({ id: Number(req.params.id) });
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
    if (venta.estado === 'cancelada') return res.status(400).json({ error: 'La venta ya estaba cancelada' });

    const deltas = {};
    for (const it of venta.items || []) {
      if (it.id != null && (await Producto.exists({ id: it.id }))) deltas[it.id] = (deltas[it.id] || 0) + (Number(it.cantidad) || 0);
    }
    const aplicados = await aplicarStock(deltas);
    try {
      const neto = netoCobrado(venta);
      const ahora = new Date().toISOString();
      if (neto > 0) venta.reembolsos.push({ fecha: ahora, monto: neto, motivo: 'Cancelación' });
      venta.estado = 'cancelada';
      venta.fechaCancelacion = ahora;
      recalcularEstado(venta);
      await venta.save();
      res.json(venta.toObject());
    } catch (err) {
      await revertirStock(aplicados);
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

export { aplicarStock, recalcularEstado };
export default router;
