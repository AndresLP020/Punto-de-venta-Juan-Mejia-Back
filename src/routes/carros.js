import { Router } from 'express';
import mongoose from 'mongoose';
import { Carro } from '../models/Carro.js';
import { requirePermiso } from '../auth.js';
import { numero, serverError, texto } from '../utils.js';

const router = Router();
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listar() {
  const docs = await Carro.find().sort({ nombre: 1 }).lean();
  return docs.map((c) => ({ id: String(c._id), nombre: c.nombre, pesoKg: c.pesoKg }));
}

router.get('/', async (req, res) => {
  try {
    res.json(await listar());
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', requirePermiso('actualizarProductos'), async (req, res) => {
  try {
    const nombre = texto(req.body?.nombre, 60);
    const pesoKg = Math.round(numero(req.body?.pesoKg, -1) * 1000) / 1000;
    if (!nombre) return res.status(400).json({ error: 'El nombre del carro es requerido' });
    if (!(pesoKg > 0) || pesoKg > 1000) return res.status(400).json({ error: 'El peso del carro debe ser mayor a 0 kg' });
    const existe = await Carro.findOne({ nombre: { $regex: new RegExp('^' + escaparRegex(nombre) + '$', 'i') } });
    if (existe) return res.status(400).json({ error: 'Ya existe un carro con ese nombre' });
    await Carro.create({ nombre, pesoKg });
    res.status(201).json(await listar());
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Ya existe un carro con ese nombre' });
    serverError(res, err);
  }
});

router.delete('/:id', requirePermiso('actualizarProductos'), async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Carro no encontrado' });
    const r = await Carro.deleteOne({ _id: id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Carro no encontrado' });
    res.json(await listar());
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
