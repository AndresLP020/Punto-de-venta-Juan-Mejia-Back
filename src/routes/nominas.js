import { Router } from 'express';
import { getNextId } from '../db.js';
import { Nomina } from '../models/Nomina.js';
import { Adelanto } from '../models/Adelanto.js';
import { GastoAdmin } from '../models/GastoAdmin.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const nominas = await Nomina.find().sort({ id: -1 }).lean();
    res.json(nominas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getLunesSemana(d) {
  const date = d ? new Date(d) : new Date();
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const lunes = new Date(date);
  lunes.setDate(diff);
  lunes.setHours(0, 0, 0, 0);
  return lunes.toISOString().slice(0, 10);
}

router.post('/', async (req, res) => {
  try {
    const { items, fecha } = req.body;
    const itemsArr = Array.isArray(items) ? items : [];
    const semanaRef = getLunesSemana(fecha || new Date());
    const itemsConDescuento = [];
    for (const i of itemsArr) {
      const montoBruto = Number(i.monto) || 0;
      const empleadoId = i.empleadoId;
      const adelantosActivos = await Adelanto.find({ empleadoId, estado: 'activo' }).sort({ id: 1 });
      let adelantoDescontado = 0;
      const maxDescuento = montoBruto;
      for (const ad of adelantosActivos) {
        if (adelantoDescontado >= maxDescuento) break;
        const semanaAdelanto = ad.fecha ? getLunesSemana(ad.fecha) : null;
        if (semanaAdelanto == null || semanaRef <= semanaAdelanto) continue;
        const aDescontar = Math.min(ad.montoPorSemana, ad.saldoPendiente, maxDescuento - adelantoDescontado);
        if (aDescontar > 0) {
          adelantoDescontado += aDescontar;
          const nuevoSaldo = Math.round((ad.saldoPendiente - aDescontar) * 100) / 100;
          await Adelanto.updateOne(
            { id: ad.id },
            { $set: { saldoPendiente: nuevoSaldo, estado: nuevoSaldo <= 0 ? 'liquidado' : 'activo' } }
          );
        }
      }
      itemsConDescuento.push({
        empleadoId: i.empleadoId,
        nombre: i.nombre,
        monto: montoBruto,
        diasTrabajados: i.diasTrabajados != null ? Number(i.diasTrabajados) : 7,
        semana: i.semana || semanaRef,
        adelantoDescontado: Math.round(adelantoDescontado * 100) / 100,
      });
    }
    if (itemsConDescuento.length === 0) return res.status(400).json({ error: 'Selecciona al menos un trabajador' });
    // Total = lo que se paga hoy (sueldo bruto menos adelantos descontados). El adelanto ya se registró como gasto al entregarse.
    const totalNum = Math.round(itemsConDescuento.reduce((s, i) => s + i.monto - i.adelantoDescontado, 0) * 100) / 100;
    const id = await getNextId(Nomina);
    const fechaIso = fecha ? new Date(fecha).toISOString() : new Date().toISOString();
    const nomina = await Nomina.create({
      id,
      fecha: fechaIso,
      items: itemsConDescuento,
      total: totalNum,
    });
    // Registrar automáticamente en Gastos Admin (categoría Sueldos) para que aparezca en el apartado de gastos
    if (totalNum > 0) {
      const gastoId = await getNextId(GastoAdmin);
      const fechaCorta = new Date(fechaIso).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
      await GastoAdmin.create({
        id: gastoId,
        fecha: fechaIso,
        descripcion: `Nómina semanal (${fechaCorta})`,
        categoria: 'Sueldos',
        monto: totalNum,
      });
    }
    res.status(201).json(nomina.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
