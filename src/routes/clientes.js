import { Router } from 'express';
import { getNextId } from '../db.js';
import { Cliente } from '../models/Cliente.js';
import { Venta } from '../models/Venta.js';
import { HttpError, serverError, texto } from '../utils.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const clientes = await Cliente.find().sort({ id: 1 }).lean();
    res.json(clientes);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const c = await Cliente.findOne({ id: Number(req.params.id) }).lean();
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(c);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const nombre = texto(body.nombre, 120);
    if (!nombre) throw new HttpError(400, 'El nombre es requerido');
    const id = await getNextId(Cliente);
    const nuevo = await Cliente.create({
      id,
      nombre,
      telefono: texto(body.telefono, 40),
      email: texto(body.email, 120),
      direccion: texto(body.direccion, 300),
    });
    res.status(201).json(nuevo.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await Cliente.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Cliente no encontrado' });
    const body = req.body || {};
    if (body.nombre != null) {
      const nombre = texto(body.nombre, 120);
      if (!nombre) throw new HttpError(400, 'El nombre es requerido');
      doc.nombre = nombre;
    }
    if (body.telefono != null) doc.telefono = texto(body.telefono, 40);
    if (body.email != null) doc.email = texto(body.email, 120);
    if (body.direccion != null) doc.direccion = texto(body.direccion, 300);
    await doc.save();
    res.json(doc.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conDeuda = await Venta.countDocuments({ clienteId: id, estado: 'pendiente', pendiente: { $gt: 0 } });
    if (conDeuda > 0) {
      return res.status(400).json({ error: `No se puede eliminar: el cliente tiene ${conDeuda} venta(s) con saldo pendiente` });
    }
    const r = await Cliente.deleteOne({ id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.status(204).send();
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
