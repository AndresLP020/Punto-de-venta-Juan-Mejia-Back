import { Router } from 'express';
import { getNextId } from '../db.js';
import { Oferta } from '../models/Oferta.js';

const router = Router();
const redondear2 = (n) => Math.round(Number(n) * 100) / 100;

// GET /api/ofertas?soloActivas=1
router.get('/', async (req, res) => {
  try {
    const soloActivas = req.query.soloActivas === '1' || req.query.soloActivas === 'true';
    const query = {};
    if (soloActivas) {
      query.activa = true;
    }
    let ofertas = await Oferta.find(query).sort({ id: -1 }).lean();
    if (soloActivas) {
      const hoy = new Date().toISOString().slice(0, 10);
      ofertas = ofertas.filter((o) => {
        const inicioOk = !o.fechaInicio || o.fechaInicio.slice(0, 10) <= hoy;
        const finOk = !o.fechaFin || o.fechaFin.slice(0, 10) >= hoy;
        return inicioOk && finOk;
      });
    }
    res.json(ofertas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const o = await Oferta.findOne({ id: Number(req.params.id) }).lean();
    if (!o) return res.status(404).json({ error: 'Oferta no encontrada' });
    res.json(o);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { titulo, descripcion, imagen, precioNormal, precioOferta, productos, activa, fechaInicio, fechaFin } = req.body;
    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ error: 'El título de la oferta es obligatorio' });
    }
    const id = await getNextId(Oferta);
    const nueva = await Oferta.create({
      id,
      titulo: String(titulo).trim(),
      descripcion: descripcion || '',
      imagen: imagen || '',
      precioNormal: redondear2(precioNormal) || 0,
      precioOferta: redondear2(precioOferta) || 0,
      productos: Array.isArray(productos) ? productos : [],
      activa: activa != null ? Boolean(activa) : true,
      fechaInicio: fechaInicio || '',
      fechaFin: fechaFin || '',
      creadaEn: new Date().toISOString(),
    });
    res.status(201).json(nueva.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await Oferta.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Oferta no encontrada' });
    const { titulo, descripcion, imagen, precioNormal, precioOferta, productos, activa, fechaInicio, fechaFin } = req.body;
    if (titulo != null) doc.titulo = String(titulo).trim();
    if (descripcion != null) doc.descripcion = descripcion;
    if (imagen != null) doc.imagen = imagen;
    if (precioNormal != null) doc.precioNormal = redondear2(precioNormal);
    if (precioOferta != null) doc.precioOferta = redondear2(precioOferta);
    if (productos != null) doc.productos = Array.isArray(productos) ? productos : [];
    if (activa != null) doc.activa = Boolean(activa);
    if (fechaInicio != null) doc.fechaInicio = fechaInicio;
    if (fechaFin != null) doc.fechaFin = fechaFin;
    await doc.save();
    res.json(doc.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await Oferta.deleteOne({ id: Number(req.params.id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Oferta no encontrada' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
