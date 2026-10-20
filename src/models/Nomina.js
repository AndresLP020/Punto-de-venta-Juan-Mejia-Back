import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
  empleadoId: Number,
  nombre: String,
  monto: Number,
  diasTrabajados: { type: Number, default: 7 },
  semana: String,
  adelantoDescontado: { type: Number, default: 0 },
  /** Detalle de qué adelantos se descontaron (para poder revertir si se elimina la nómina). */
  adelantosAplicados: { type: [{ adelantoId: Number, monto: Number }], default: [] },
}, { _id: false });

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  fecha: String,
  items: [itemSchema],
  total: Number,
  /** Gasto creado automáticamente en Gastos Admin (categoría Sueldos). */
  gastoAdminId: Number,
});

export const Nomina = mongoose.model('Nomina', schema);
