import { Router } from 'express';
import { getNextId } from '../db.js';
import { MovimientoLienzo } from '../models/MovimientoLienzo.js';
import { GastoAdmin } from '../models/GastoAdmin.js';
import { fechaLocalISO, numero, redondear2, serverError, texto } from '../utils.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const movimientos = await MovimientoLienzo.find().sort({ fecha: -1, id: -1 }).lean();
    res.json(movimientos);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { fecha, tipo, descripcion, monto } = req.body || {};
    if (!tipo || (tipo !== 'ingreso' && tipo !== 'gasto')) {
      return res.status(400).json({ error: 'tipo debe ser "ingreso" o "gasto"' });
    }
    const montoNum = redondear2(numero(monto, NaN));
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ error: 'monto debe ser mayor a 0' });
    }
    const descripcionStr = texto(descripcion);
    // Guardar solo la fecha (YYYY-MM-DD) en la zona horaria del negocio para evitar desfases de un día.
    const fechaStr = fecha && /^\d{4}-\d{2}-\d{2}/.test(String(fecha)) ? String(fecha).slice(0, 10) : fechaLocalISO();

    const id = await getNextId(MovimientoLienzo);
    let gastoAdminId;
    if (tipo === 'gasto') {
      // Se registra también en Gastos Admin para que se descuente de la ganancia neta en todos los apartados.
      gastoAdminId = await getNextId(GastoAdmin);
      await GastoAdmin.create({
        id: gastoAdminId,
        fecha: fechaStr,
        descripcion: descripcionStr ? `Lienzo Charro: ${descripcionStr}` : 'Lienzo Charro',
        categoria: 'Lienzo Charro',
        monto: montoNum,
        lienzoId: id,
      });
    }

    try {
      const doc = await MovimientoLienzo.create({ id, fecha: fechaStr, tipo, descripcion: descripcionStr, monto: montoNum, gastoAdminId });
      res.status(201).json(doc.toObject());
    } catch (err) {
      if (gastoAdminId) await GastoAdmin.deleteOne({ id: gastoAdminId }).catch(() => {});
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const mov = await MovimientoLienzo.findOne({ id: Number(req.params.id) }).lean();
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
    if (mov.tipo === 'gasto') {
      // Borrar también el gasto que se creó en Gastos Admin (los registros antiguos no guardaban el vínculo).
      if (mov.gastoAdminId) await GastoAdmin.deleteOne({ id: mov.gastoAdminId });
      else {
        await GastoAdmin.deleteOne({
          categoria: 'Lienzo Charro',
          fecha: mov.fecha,
          monto: mov.monto,
          descripcion: mov.descripcion ? `Lienzo Charro: ${mov.descripcion}` : 'Lienzo Charro',
        });
      }
    }
    await MovimientoLienzo.deleteOne({ id: mov.id });
    res.status(204).send();
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
