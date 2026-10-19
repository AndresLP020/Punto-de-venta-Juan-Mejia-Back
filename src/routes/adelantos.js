import { Router } from 'express';
import { getNextId } from '../db.js';
import { Adelanto } from '../models/Adelanto.js';
import { Empleado } from '../models/Empleado.js';
import { GastoAdmin } from '../models/GastoAdmin.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const estado = req.query.estado;
    const query = estado ? { estado } : {};
    const adelantos = await Adelanto.find(query).sort({ id: -1 }).lean();
    res.json(adelantos);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { empleadoId, montoTotal, semanas } = req.body;
    const monto = Number(montoTotal) || 0;
    const numSemanas = Math.max(1, Math.round(Number(semanas) || 1));
    if (monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    const empleado = await Empleado.findOne({ id: Number(empleadoId) }).lean();
    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });
    const montoPorSemana = Math.round((monto / numSemanas) * 100) / 100;
    const id = await getNextId(Adelanto);
    const adelanto = await Adelanto.create({
      id,
      empleadoId: Number(empleadoId),
      nombre: empleado.nombre,
      montoTotal: monto,
      semanas: numSemanas,
      montoPorSemana: montoPorSemana,
      saldoPendiente: monto,
      fecha: new Date().toISOString(),
      estado: 'activo',
    });
    // El adelanto es dinero que sale hoy: se registra como gasto (Sueldos)
    const gastoId = await getNextId(GastoAdmin);
    await GastoAdmin.create({
      id: gastoId,
      fecha: adelanto.fecha,
      descripcion: `Adelanto de sueldo (${empleado.nombre})`,
      categoria: 'Sueldos',
      monto,
    });
    res.status(201).json(adelanto.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
