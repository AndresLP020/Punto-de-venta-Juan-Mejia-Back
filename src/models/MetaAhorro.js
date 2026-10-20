import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  nombre: { type: String, required: true },
  meta: { type: Number, required: true },
  fechaLimite: { type: String, required: true },
  estado: { type: String, default: 'activa' },
});

export const MetaAhorro = mongoose.model('MetaAhorro', schema);
