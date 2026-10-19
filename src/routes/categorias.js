import { Router } from 'express';
import { Categoria } from '../models/Categoria.js';
import { requierePermiso } from '../seguridad.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const docs = await Categoria.find().sort({ nombre: 1 }).lean();
    res.json(docs.map((c) => c.nombre));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requierePermiso('actualizarProductos'), async (req, res) => {
  try {
    const { nombre } = req.body;
    const name = String(nombre || '').trim();
    if (!name) return res.status(400).json({ error: 'El nombre de la categoría es requerido' });
    const existe = await Categoria.findOne({ nombre: { $regex: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
    if (existe) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    await Categoria.create({ nombre: name });
    const docs = await Categoria.find().sort({ nombre: 1 }).lean();
    res.status(201).json(docs.map((c) => c.nombre));
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:nombre', requierePermiso('actualizarProductos'), async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const r = await Categoria.deleteOne({ nombre });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    const docs = await Categoria.find().sort({ nombre: 1 }).lean();
    res.status(200).json(docs.map((c) => c.nombre));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
