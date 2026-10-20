import { Router } from 'express';
import { getNextId } from '../db.js';
import { GastoAdmin } from '../models/GastoAdmin.js';
import { HttpError, fechaLocalISO, normalizarFecha, numero, redondear2, serverError, texto } from '../utils.js';

const router = Router();

function validarMonto(monto) {
  const n = redondear2(numero(monto, NaN));
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'El monto debe ser mayor a 0');
  return n;
}

function mensajeAutomatico(g) {
  if (g.nominaId) return 'Este gasto se generó desde una nómina: modifícalo o elimínalo desde Sueldos';
  if (g.lienzoId) return 'Este gasto se generó desde Lienzo Charro: modifícalo o elimínalo desde ese apartado';
  return null;
}

router.get('/', async (req, res) => {
  try {
    const gastos = await GastoAdmin.find().sort({ id: -1 }).lean();
    res.json(gastos);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const g = await GastoAdmin.findOne({ id: Number(req.params.id) }).lean();
    if (!g) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(g);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { fecha, descripcion, categoria, monto } = req.body || {};
    const id = await getNextId(GastoAdmin);
    const gasto = await GastoAdmin.create({
      id,
      fecha: normalizarFecha(fecha) ?? fechaLocalISO(),
      descripcion: texto(descripcion),
      categoria: texto(categoria, 80) || 'Diversos',
      monto: validarMonto(monto),
    });
    res.status(201).json(gasto.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await GastoAdmin.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Gasto no encontrado' });
    const bloqueo = mensajeAutomatico(doc);
    if (bloqueo) return res.status(400).json({ error: bloqueo });
    const { fecha, descripcion, categoria, monto } = req.body || {};
    if (fecha != null) doc.fecha = normalizarFecha(fecha) ?? doc.fecha;
    if (descripcion != null) doc.descripcion = texto(descripcion);
    if (categoria != null) doc.categoria = texto(categoria, 80) || 'Diversos';
    if (monto != null) doc.monto = validarMonto(monto);
    await doc.save();
    res.json(doc.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await GastoAdmin.findOne({ id: Number(req.params.id) }).lean();
    if (!doc) return res.status(404).json({ error: 'Gasto no encontrado' });
    const bloqueo = mensajeAutomatico(doc);
    if (bloqueo) return res.status(400).json({ error: bloqueo });
    await GastoAdmin.deleteOne({ id: doc.id });
    res.status(204).send();
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
