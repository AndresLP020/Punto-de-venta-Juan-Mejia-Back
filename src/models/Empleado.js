import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  nombre: String,
  sueldo: Number,
  puesto: String,
});
export const Empleado = mongoose.model('Empleado', schema);
