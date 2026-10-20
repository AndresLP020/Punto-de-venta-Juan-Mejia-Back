import { Router } from 'express';
import { getNextId } from '../db.js';
import { Proveedor } from '../models/Proveedor.js';
import { CuentaProveedor } from '../models/CuentaProveedor.js';
import { normalizarFecha, numero, redondear2, serverError, texto } from '../utils.js';

const router = Router();

// Listado de movimientos por proveedor
router.get('/:proveedorId', async (req, res) => {
  try {
    const proveedorId = Number(req.params.proveedorId);
    if (!proveedorId) return res.status(400).json({ error: 'proveedorId inválido' });

    const movimientos = await CuentaProveedor.find({ proveedorId }).sort({ fecha: -1, id: -1 }).lean();
    res.json(movimientos);
  } catch (err) {
    serverError(res, err);
  }
});

// Resumen por proveedor (saldos)
router.get('/', async (req, res) => {
  try {
    const movimientos = await CuentaProveedor.find().lean();
    const resumenMap = new Map();

    for (const mov of movimientos) {
      const key = mov.proveedorId;
      if (!resumenMap.has(key)) {
        resumenMap.set(key, {
          proveedorId: mov.proveedorId,
          proveedorNombre: mov.proveedorNombre,
          totalDeuda: 0,
          totalPagos: 0,
          saldoPendiente: 0,
        });
      }
      const r = resumenMap.get(key);
      if (mov.tipo === 'deuda') {
        r.totalDeuda += mov.monto;
      } else if (mov.tipo === 'pago') {
        r.totalPagos += mov.monto;
      }
      r.saldoPendiente = r.totalDeuda - r.totalPagos;
    }

    res.json(Array.from(resumenMap.values()));
  } catch (err) {
    serverError(res, err);
  }
});

// Registrar deuda o pago
router.post('/', async (req, res) => {
  try {
    const { proveedorId, tipo, monto, descripcion, fecha } = req.body;
    const proveedorIdNum = Number(proveedorId);
    const montoNum = redondear2(numero(monto));

    if (!proveedorIdNum) return res.status(400).json({ error: 'proveedorId es requerido' });
    if (!tipo || (tipo !== 'deuda' && tipo !== 'pago')) {
      return res.status(400).json({ error: 'tipo debe ser "deuda" o "pago"' });
    }
    if (!montoNum || montoNum <= 0) {
      return res.status(400).json({ error: 'monto debe ser mayor a 0' });
    }

    const proveedor = await Proveedor.findOne({ id: proveedorIdNum });
    if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' });

    const id = await getNextId(CuentaProveedor);
    const nowIso = new Date().toISOString();

    const doc = await CuentaProveedor.create({
      id,
      proveedorId: proveedorIdNum,
      proveedorNombre: proveedor.nombre,
      tipo,
      fecha: normalizarFecha(fecha) ?? nowIso,
      descripcion: texto(descripcion),
      monto: montoNum,
    });

    res.status(201).json(doc.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

// Eliminar un movimiento registrado por error.
router.delete('/movimiento/:id', async (req, res) => {
  try {
    const r = await CuentaProveedor.deleteOne({ id: Number(req.params.id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Movimiento no encontrado' });
    res.status(204).send();
  } catch (err) {
    serverError(res, err);
  }
});

export default router;

