import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  empleadoId: { type: Number, required: true },
  nombre: String,
  montoTotal: { type: Number, required: true },
  semanas: { type: Number, required: true },
  montoPorSemana: { type: Number, required: true },
  saldoPendiente: { type: Number, required: true },
  fecha: String,
  /** 'activo' | 'liquidado' | 'cancelado' */
  estado: { type: String, default: 'activo' },
});

export const Adelanto = mongoose.model('Adelanto', schema);
