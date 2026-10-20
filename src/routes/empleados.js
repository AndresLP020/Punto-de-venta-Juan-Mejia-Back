import { Router } from 'express';
import { getNextId } from '../db.js';
import { Empleado } from '../models/Empleado.js';
import { Adelanto } from '../models/Adelanto.js';
import { HttpError, numero, redondear2, serverError, texto } from '../utils.js';

const router = Router();

function validarSueldo(v) {
  const n = redondear2(numero(v, NaN));
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'El sueldo debe ser un número mayor o igual a 0');
  return n;
}

router.get('/', async (req, res) => {
  try {
    const empleados = await Empleado.find().sort({ id: 1 }).lean();
    res.json(empleados);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const e = await Empleado.findOne({ id: Number(req.params.id) }).lean();
    if (!e) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(e);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, sueldo, puesto } = req.body || {};
    const nombreLimpio = texto(nombre, 120);
    if (!nombreLimpio) throw new HttpError(400, 'El nombre es requerido');
    const id = await getNextId(Empleado);
    const empleado = await Empleado.create({ id, nombre: nombreLimpio, sueldo: validarSueldo(sueldo ?? 0), puesto: texto(puesto, 80) });
    res.status(201).json(empleado.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await Empleado.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Empleado no encontrado' });
    const { nombre, sueldo, puesto } = req.body || {};
    if (nombre != null) {
      const n = texto(nombre, 120);
      if (!n) throw new HttpError(400, 'El nombre es requerido');
      doc.nombre = n;
    }
    if (sueldo != null) doc.sueldo = validarSueldo(sueldo);
    if (puesto != null) doc.puesto = texto(puesto, 80);
    await doc.save();
    res.json(doc.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const activos = await Adelanto.countDocuments({ empleadoId: id, estado: 'activo' });
    if (activos > 0) {
      return res.status(400).json({ error: 'No se puede eliminar: el empleado tiene adelantos pendientes de descontar' });
    }
    const r = await Empleado.deleteOne({ id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.status(204).send();
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
