import { Router } from 'express';
import { getNextId } from '../db.js';
import { Proveedor } from '../models/Proveedor.js';
import { Producto } from '../models/Producto.js';
import { CuentaProveedor } from '../models/CuentaProveedor.js';
import { HttpError, serverError, texto } from '../utils.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const proveedores = await Proveedor.find().sort({ id: 1 }).lean();
    res.json(proveedores);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await Proveedor.findOne({ id: Number(req.params.id) }).lean();
    if (!p) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(p);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const nombre = texto(body.nombre, 120);
    if (!nombre) throw new HttpError(400, 'El nombre es requerido');
    const id = await getNextId(Proveedor);
    const nuevo = await Proveedor.create({
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
    const doc = await Proveedor.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const body = req.body || {};
    if (body.nombre != null) {
      const nombre = texto(body.nombre, 120);
      if (!nombre) throw new HttpError(400, 'El nombre es requerido');
      if (nombre !== doc.nombre) await CuentaProveedor.updateMany({ proveedorId: doc.id }, { $set: { proveedorNombre: nombre } });
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
    const movimientos = await CuentaProveedor.find({ proveedorId: id }).lean();
    const saldo = movimientos.reduce((s, m) => s + (m.tipo === 'deuda' ? m.monto : -m.monto), 0);
    if (Math.abs(saldo) > 0.005) {
      return res.status(400).json({ error: `No se puede eliminar: hay un saldo pendiente de $${saldo.toFixed(2)} con este proveedor` });
    }
    const r = await Proveedor.deleteOne({ id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });
    await Producto.updateMany({ proveedorId: id }, { $set: { proveedorId: null } });
    res.status(204).send();
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
