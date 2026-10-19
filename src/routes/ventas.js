import { Router } from 'express';
import { getNextId } from '../db.js';
import { Venta } from '../models/Venta.js';
import { Producto } from '../models/Producto.js';
import { requiereAdmin, requierePermiso, requiereSesion } from '../seguridad.js';

const router = Router();
const redondear2 = (n) => Math.round(Number(n) * 100) / 100;

router.get('/', requiereSesion, async (req, res) => {
  try {
    const ventas = await Venta.find().sort({ id: -1 }).lean();
    res.json(ventas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requierePermiso('hacerVentas'), async (req, res) => {
  try {
    const { items, cliente, clienteId, pagado } = req.body || {};
    const itemsConCosto = (Array.isArray(items) ? items : [])
      .map((it) => ({
        id: Number(it.id),
        nombre: String(it.nombre || 'Producto'),
        precio: redondear2(it.precio) || 0,
        cantidad: Number(it.cantidad) || 0,
        costo: it.costo != null ? Number(it.costo) : 0,
      }))
      .filter((it) => it.cantidad > 0);
    if (itemsConCosto.length === 0) return res.status(400).json({ error: 'La venta no tiene productos' });
    if (itemsConCosto.some((it) => it.precio < 0)) return res.status(400).json({ error: 'Hay precios inválidos' });

    // El total se calcula en el servidor a partir de los productos
    const totalVenta = redondear2(itemsConCosto.reduce((s, it) => s + it.precio * it.cantidad, 0));
    const pagadoNum = pagado === undefined || pagado === null || pagado === '' ? totalVenta : Number(pagado);
    if (!Number.isFinite(pagadoNum) || pagadoNum < 0) return res.status(400).json({ error: 'El monto pagado no es válido' });
    const pagadoVenta = redondear2(pagadoNum);

    // Descontar stock solo si alcanza (operación atómica por producto); si uno falla se revierte todo
    const descontados = [];
    for (const it of itemsConCosto) {
      const prod = await Producto.findOneAndUpdate(
        { id: it.id, stock: { $gte: it.cantidad } },
        { $inc: { stock: -it.cantidad } },
        { new: true }
      );
      if (!prod) {
        for (const d of descontados) await Producto.updateOne({ id: d.id }, { $inc: { stock: d.cantidad } });
        const actual = await Producto.findOne({ id: it.id }).lean();
        return res.status(400).json({
          error: actual
            ? `No hay stock suficiente para "${it.nombre}". Disponible: ${actual.stock ?? 0}, solicitado: ${it.cantidad}`
            : `El producto "${it.nombre}" ya no existe`,
        });
      }
      descontados.push(it);
    }

    const id = await getNextId(Venta);
    const pendiente = Math.max(0, redondear2(totalVenta - pagadoVenta));
    const venta = await Venta.create({
      id,
      fecha: new Date().toISOString(),
      items: itemsConCosto,
      total: totalVenta,
      pagado: pagadoVenta,
      pendiente,
      cliente: cliente || '',
      clienteId: clienteId ? Number(clienteId) : null,
      estado: pendiente <= 0 ? 'pagado' : 'pendiente',
    });
    res.status(201).json(venta.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Editar ticket: modificar items (precio, cantidad), agregar o quitar productos. Ajusta inventario y recalcula total/ganancias.
router.put('/:id', requiereAdmin, async (req, res) => {
  try {
    const ventaId = Number(req.params.id);
    const venta = await Venta.findOne({ id: ventaId });
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const { items: itemsBody } = req.body || {};
    const rawItems = Array.isArray(itemsBody) ? itemsBody : [];
    if (rawItems.length === 0) return res.status(400).json({ error: 'Debe enviar al menos un producto en items' });

    const itemsViejos = venta.items || [];
    const itemsNuevos = rawItems.map((it) => ({
      id: Number(it.id),
      nombre: String(it.nombre || '').trim() || 'Producto',
      precio: Number(it.precio) || 0,
      cantidad: Math.max(0, Number(it.cantidad) || 0),
      costo: it.costo != null ? Number(it.costo) : 0,
    })).filter((it) => it.cantidad > 0);

    if (itemsNuevos.length === 0) return res.status(400).json({ error: 'Debe haber al menos un ítem con cantidad mayor a 0' });

    // Obtener costo de productos que no lo traen (ej. recién agregados al ticket)
    for (const it of itemsNuevos) {
      if (it.costo == null || (it.costo === 0 && it.id)) {
        const prod = await Producto.findOne({ id: it.id }).lean();
        if (prod && prod.costo != null) it.costo = Number(prod.costo);
      }
    }

    // 1) Devolver al inventario lo que tenía la venta original
    for (const it of itemsViejos) {
      const cant = Number(it.cantidad) || 0;
      if (cant > 0 && it.id != null) {
        await Producto.findOneAndUpdate(
          { id: it.id },
          { $inc: { stock: cant } }
        );
      }
    }

    // 2) Descontar del inventario lo que tendrá la venta nueva
    const yaDescontados = [];
    for (const it of itemsNuevos) {
      if (it.cantidad > 0 && it.id != null) {
        const prod = await Producto.findOne({ id: it.id });
        if (prod) {
          const stockActual = Number(prod.stock) || 0;
          const nuevoStock = stockActual - it.cantidad;
          if (nuevoStock < 0) {
            // Revertir lo que ya se descontó de la venta nueva y lo que devolvimos
            for (const d of yaDescontados) {
              await Producto.findOneAndUpdate({ id: d.id }, { $inc: { stock: d.cantidad } });
            }
            for (const prev of itemsViejos) {
              const c = Number(prev.cantidad) || 0;
              if (c > 0 && prev.id != null) {
                await Producto.findOneAndUpdate({ id: prev.id }, { $inc: { stock: -c } });
              }
            }
            return res.status(400).json({
              error: `No hay stock suficiente para "${it.nombre}". Disponible: ${stockActual}, solicitado: ${it.cantidad}`,
            });
          }
          await Producto.findOneAndUpdate(
            { id: it.id },
            { $inc: { stock: -it.cantidad } }
          );
          yaDescontados.push(it);
        }
      }
    }

    const nuevoTotal = redondear2(itemsNuevos.reduce((sum, it) => sum + it.precio * it.cantidad, 0));
    const pagado = Number(venta.pagado) ?? 0;
    const nuevoPendiente = Math.max(0, nuevoTotal - pagado);
    venta.items = itemsNuevos;
    venta.total = nuevoTotal;
    venta.pendiente = nuevoPendiente;
    venta.estado = nuevoPendiente <= 0 ? 'pagado' : 'pendiente';
    await venta.save();
    res.json(venta.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/abonar', requiereSesion, async (req, res) => {
  try {
    const monto = Number(req.body?.monto);
    if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El abono debe ser mayor a 0' });
    const venta = await Venta.findOne({ id: Number(req.params.id) });
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
    if (monto > (venta.pendiente || 0) + 0.005) return res.status(400).json({ error: 'El abono es mayor a lo pendiente' });
    const nuevoPagado = redondear2((venta.pagado || 0) + monto);
    const nuevoPendiente = Math.max(0, venta.total - nuevoPagado);
    venta.pagado = nuevoPagado;
    venta.pendiente = nuevoPendiente;
    venta.estado = nuevoPendiente <= 0 ? 'pagado' : 'pendiente';
    await venta.save();
    res.json(venta.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
