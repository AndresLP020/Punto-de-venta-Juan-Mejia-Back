import mongoose from 'mongoose';

const permisosSchema = new mongoose.Schema({
  hacerVentas: { type: Boolean, default: true },
  darDeBajaProductos: { type: Boolean, default: false },
  actualizarProductos: { type: Boolean, default: true },
  borrarProductos: { type: Boolean, default: false },
}, { _id: false });

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  nombre: String,
  telefono: String,
  permisos: permisosSchema,
});

export const Usuario = mongoose.model('Usuario', schema);
