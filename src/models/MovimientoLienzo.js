import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  fecha: { type: String, required: true },
  tipo: { type: String, enum: ['ingreso', 'gasto'], required: true },
  descripcion: { type: String, default: '' },
  monto: { type: Number, required: true },
  /** Gasto creado en Gastos Admin para los movimientos de tipo 'gasto'. */
  gastoAdminId: Number,
});

export const MovimientoLienzo = mongoose.model('MovimientoLienzo', schema);
