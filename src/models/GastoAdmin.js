import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  fecha: String,
  descripcion: String,
  categoria: String,
  monto: Number,
  /** Si el gasto se generó automáticamente desde una nómina o un movimiento del Lienzo Charro. */
  nominaId: Number,
  lienzoId: Number,
});
export const GastoAdmin = mongoose.model('GastoAdmin', schema);
