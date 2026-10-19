import mongoose from 'mongoose';

export async function conectarMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';

  try {
    await mongoose.connect(uri);
    console.log('Conectado a MongoDB:', mongoose.connection.name);
  } catch (err) {
    console.error('Error al conectar a MongoDB:', err.message);
    throw err;
  }
}

// Contadores atómicos por colección: evita que dos registros creados al mismo tiempo reciban el mismo id.
const Contador = mongoose.model(
  'Contador',
  new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false })
);
export async function getNextId(Model) {
  const nombre = Model.collection.collectionName;
  // El contador nunca queda por debajo del id más alto existente (p. ej. tras cargar datos con un script)
  const last = await Model.findOne().sort({ id: -1 }).select('id').lean();
  await Contador.updateOne({ _id: nombre }, { $max: { seq: last?.id ?? 0 } }, { upsert: true });
  const c = await Contador.findOneAndUpdate({ _id: nombre }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}
