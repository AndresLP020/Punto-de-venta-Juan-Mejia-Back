import { Router } from 'express';
import { getNextId } from '../db.js';
import { Devolucion } from '../models/Devolucion.js';
import { Producto } from '../models/Producto.js';
import { requiereAdmin, requiereSesion } from '../seguridad.js';

const router = Router();

router.get('/', requiereSesion, async (req, res) => {
  try {
    const devoluciones = await Devolucion.find().sort({ id: -1 }).lean();
    res.json(devoluciones);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Lista aplanada de ítems con tipo "perdida" para el apartado de pérdidas */
router.get('/perdidas', requiereSesion, async (req, res) => {
  try {
    const devoluciones = await Devolucion.find().sort({ id: -1 }).lean();
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
            valorPerdida: Math.round(it.cantidad * it.precio * 100) / 100,
          });
        }
      }
    }
    res.json(perdidas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requiereAdmin, async (req, res) => {
  try {
    const { ventaId, items } = req.body;
    const ventaIdNum = ventaId != null && ventaId !== '' ? Number(ventaId) : 0;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un ítem' });
    }
    const itemsValidados = items
      .filter((it) => it.id != null && (it.cantidad || 0) > 0 && ['revendible', 'perdida'].includes(it.tipo))
      .map((it) => ({
        productoId: Number(it.id),
        nombre: it.nombre || '',
        cantidad: Number(it.cantidad) || 0,
        precio: Number(it.precio) || 0,
        tipo: it.tipo === 'perdida' ? 'perdida' : 'revendible',
      }));
    if (itemsValidados.length === 0) {
      return res.status(400).json({ error: 'Ningún ítem válido (cantidad > 0 y tipo revendible o perdida)' });
    }
    const id = await getNextId(Devolucion);
    const fechaIso = new Date().toISOString();
    await Devolucion.create({
      id,
      fecha: fechaIso,
      ventaId: ventaIdNum,
      items: itemsValidados,
    });
    for (const it of itemsValidados) {
      if (it.tipo === 'revendible') {
        await Producto.findOneAndUpdate(
          { id: it.productoId },
          { $inc: { stock: it.cantidad } }
        );
      }
    }
    const creada = await Devolucion.findOne({ id }).lean();
    res.status(201).json(creada);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
