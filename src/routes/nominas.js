import { Router } from 'express';
import { getNextId } from '../db.js';
import { Nomina } from '../models/Nomina.js';
import { Adelanto } from '../models/Adelanto.js';
import { Empleado } from '../models/Empleado.js';
import { GastoAdmin } from '../models/GastoAdmin.js';
import { APP_TZ, HttpError, lunesDeSemana, normalizarFecha, numero, redondear2, serverError } from '../utils.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const nominas = await Nomina.find().sort({ id: -1 }).lean();
    res.json(nominas);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { items, fecha } = req.body || {};
    const itemsArr = Array.isArray(items) ? items : [];
    if (itemsArr.length === 0) throw new HttpError(400, 'Selecciona al menos un empleado');
    const fechaIso = normalizarFecha(fecha) ?? new Date().toISOString();
    const semanaRef = lunesDeSemana(fechaIso);

    // Validar todo antes de modificar nada.
    const ids = itemsArr.map((i) => Number(i.empleadoId));
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Un empleado aparece dos veces en la nómina');
    const empleados = await Empleado.find({ id: { $in: ids } }).lean();
    const empleadoPorId = new Map(empleados.map((e) => [e.id, e]));
    const pagadasSemana = await Nomina.find({ 'items.semana': semanaRef }).lean();
    const yaPagados = new Set(pagadasSemana.flatMap((n) => n.items.filter((i) => i.semana === semanaRef).map((i) => i.empleadoId)));

    const lineas = itemsArr.map((i) => {
      const empleadoId = Number(i.empleadoId);
      const empleado = empleadoPorId.get(empleadoId);
      if (!empleado) throw new HttpError(400, `Empleado #${i.empleadoId} no encontrado`);
      if (yaPagados.has(empleadoId)) throw new HttpError(400, `${empleado.nombre} ya tiene nómina registrada en la semana del ${semanaRef}`);
      const monto = redondear2(numero(i.monto, NaN));
      if (!Number.isFinite(monto) || monto < 0) throw new HttpError(400, `Monto inválido para ${empleado.nombre}`);
      const dias = i.diasTrabajados != null ? numero(i.diasTrabajados, 7) : 7;
      return { empleadoId, nombre: empleado.nombre, monto, diasTrabajados: Math.min(7, Math.max(0, dias)) };
    });

    const itemsConDescuento = [];
    const descuentosAplicados = [];
    try {
      for (const linea of lineas) {
        const adelantosActivos = await Adelanto.find({ empleadoId: linea.empleadoId, estado: 'activo' }).sort({ id: 1 });
        let adelantoDescontado = 0;
        const adelantosAplicados = [];
        for (const ad of adelantosActivos) {
          if (adelantoDescontado >= linea.monto) break;
          // Un adelanto empieza a descontarse en la semana siguiente a la que se entregó.
          const semanaAdelanto = ad.fecha ? lunesDeSemana(ad.fecha) : null;
          if (semanaAdelanto == null || semanaRef <= semanaAdelanto) continue;
          const aDescontar = redondear2(Math.min(ad.montoPorSemana, ad.saldoPendiente, linea.monto - adelantoDescontado));
          if (aDescontar > 0) {
            const actualizado = await Adelanto.findOneAndUpdate(
              { id: ad.id, estado: 'activo', saldoPendiente: { $gte: aDescontar } },
              { $inc: { saldoPendiente: -aDescontar } },
              { new: true }
            );
            if (!actualizado) continue;
            descuentosAplicados.push({ adelantoId: ad.id, monto: aDescontar });
            if (actualizado.saldoPendiente <= 0.005) {
              await Adelanto.updateOne({ id: ad.id }, { $set: { saldoPendiente: 0, estado: 'liquidado' } });
            }
            adelantoDescontado = redondear2(adelantoDescontado + aDescontar);
            adelantosAplicados.push({ adelantoId: ad.id, monto: aDescontar });
          }
        }
        itemsConDescuento.push({ ...linea, semana: semanaRef, adelantoDescontado, adelantosAplicados });
      }

      // El total es el sueldo bruto; lo descontado de adelantos ya se había entregado al empleado como adelanto.
      const total = redondear2(itemsConDescuento.reduce((s, i) => s + i.monto, 0));
      const id = await getNextId(Nomina);
      let gastoAdminId;
      if (total > 0) {
        gastoAdminId = await getNextId(GastoAdmin);
        const fechaCorta = new Date(fechaIso).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: APP_TZ });
        await GastoAdmin.create({
          id: gastoAdminId,
          fecha: fechaIso,
          descripcion: `Nómina semanal (${fechaCorta})`,
          categoria: 'Sueldos',
          monto: total,
          nominaId: id,
        });
      }
      const nomina = await Nomina.create({ id, fecha: fechaIso, items: itemsConDescuento, total, gastoAdminId });
      res.status(201).json(nomina.toObject());
    } catch (err) {
      await revertirDescuentos(descuentosAplicados);
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

async function revertirDescuentos(descuentos) {
  for (const d of descuentos) {
    await Adelanto.updateOne({ id: d.adelantoId }, { $inc: { saldoPendiente: d.monto }, $set: { estado: 'activo' } }).catch((e) =>
      console.error('No se pudo revertir adelanto', d.adelantoId, e)
    );
  }
}

// Eliminar nómina: devuelve a los adelantos lo que se descontó y borra el gasto asociado.
router.delete('/:id', async (req, res) => {
  try {
    const nomina = await Nomina.findOne({ id: Number(req.params.id) }).lean();
    if (!nomina) return res.status(404).json({ error: 'Nómina no encontrada' });
    const descuentos = nomina.items.flatMap((i) => i.adelantosAplicados || []);
    await revertirDescuentos(descuentos);
    if (nomina.gastoAdminId) await GastoAdmin.deleteOne({ id: nomina.gastoAdminId });
    else await GastoAdmin.deleteOne({ categoria: 'Sueldos', fecha: nomina.fecha, monto: nomina.total });
    await Nomina.deleteOne({ id: nomina.id });
    const sinDetalle = nomina.items.some((i) => (i.adelantoDescontado || 0) > 0 && !(i.adelantosAplicados || []).length);
    res.json({
      ok: true,
      aviso: sinDetalle
        ? 'Esta nómina es anterior al registro detallado de adelantos: revisa manualmente el saldo de los adelantos descontados.'
        : undefined,
    });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
