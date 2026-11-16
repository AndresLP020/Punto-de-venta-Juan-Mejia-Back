import mongoose from 'mongoose';

/** Carro o recipiente con peso conocido (tara) que se descuenta al pesar productos a granel. */
const schema = new mongoose.Schema({
  nombre: { type: String, required: true, unique: true },
  pesoKg: { type: Number, required: true, min: 0 },
});
export const Carro = mongoose.model('Carro', schema);
