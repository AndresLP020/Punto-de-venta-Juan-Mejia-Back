import { Router } from 'express';
import { getNextId } from '../db.js';
import { Adelanto } from '../models/Adelanto.js';
import { Empleado } from '../models/Empleado.js';
import { numero, redondear2, serverError } from '../utils.js';

const router = Router();
const ESTADOS = ['activo', 'liquidado', 'cancelado'];

router.get('/', async (req, res) => {
  try {
    const estado = req.query.estado != null ? String(req.query.estado) : '';
    if (estado && !ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    const query = estado ? { estado } : {};
    const adelantos = await Adelanto.find(query).sort({ id: -1 }).lean();
    res.json(adelantos);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/empleado/:empleadoId', async (req, res) => {
  try {
    const adelantos = await Adelanto.find({
      empleadoId: Number(req.params.empleadoId),
      estado: 'activo',
    }).lean();
    res.json(adelantos);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { empleadoId, montoTotal, semanas } = req.body || {};
    const monto = redondear2(numero(montoTotal));
    const numSemanas = Math.min(52, Math.max(1, Math.round(numero(semanas, 1))));
    if (monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    const empleado = await Empleado.findOne({ id: Number(empleadoId) }).lean();
    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });
    const montoPorSemana = redondear2(monto / numSemanas);
    const id = await getNextId(Adelanto);
    const adelanto = await Adelanto.create({
      id,
      empleadoId: empleado.id,
      nombre: empleado.nombre,
      montoTotal: monto,
      semanas: numSemanas,
      montoPorSemana,
      saldoPendiente: monto,
      fecha: new Date().toISOString(),
      estado: 'activo',
    });
    res.status(201).json(adelanto.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

// Cancelar un adelanto (p. ej. registrado por error). Si aún no se ha descontado nada se elimina;
// si ya hubo descuentos se marca como cancelado y deja de descontarse el saldo restante.
router.delete('/:id', async (req, res) => {
  try {
    const ad = await Adelanto.findOne({ id: Number(req.params.id) });
    if (!ad) return res.status(404).json({ error: 'Adelanto no encontrado' });
    if (ad.saldoPendiente >= ad.montoTotal) {
      await Adelanto.deleteOne({ id: ad.id });
      return res.json({ ok: true, eliminado: true });
    }
    ad.estado = 'cancelado';
    await ad.save();
    res.json({ ok: true, eliminado: false, adelanto: ad.toObject() });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
