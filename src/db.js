import mongoose from 'mongoose';

export async function conectarMongo() {
  const uri = process.env.MONGODB_URI;
  const isProd = process.env.NODE_ENV === 'production';

  if (!uri) {
    if (isProd) {
      throw new Error(
        'Falta MONGODB_URI. En Render: Environment → Add Environment Variable. Usa la cadena de MongoDB Atlas (mongodb+srv://...).'
      );
    }
  }

  const connectionUri = uri || 'mongodb://localhost:27017/pos';

  try {
    await mongoose.connect(connectionUri, { serverSelectionTimeoutMS: 15000 });
    console.log('Conectado a MongoDB:', mongoose.connection.name);
  } catch (err) {
    console.error('Error al conectar a MongoDB:', err.message);
    if (isProd) {
      console.error(
        'En Atlas: Network Access debe permitir 0.0.0.0/0 (o las IPs de Render). Revisa usuario, contraseña y el nombre de la base en la URI.'
      );
    }
    throw err;
  }
}

const Contador = mongoose.model(
  'Contador',
  new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false }),
  'contadores'
);
const contadoresIniciados = new Set();

/**
 * Siguiente id numérico para un modelo. Usa un contador atómico ($inc) para que dos
 * peticiones simultáneas nunca reciban el mismo id. La primera vez se sincroniza
 * con el id más alto existente en la colección.
 */
export async function getNextId(Model) {
  const nombre = Model.modelName;
  if (!contadoresIniciados.has(nombre)) {
    const last = await Model.findOne().sort({ id: -1 }).select('id').lean();
    try {
      await Contador.updateOne({ _id: nombre }, { $max: { seq: last?.id ?? 0 } }, { upsert: true });
    } catch (err) {
      if (err.code !== 11000) throw err;
      await Contador.updateOne({ _id: nombre }, { $max: { seq: last?.id ?? 0 } });
    }
    contadoresIniciados.add(nombre);
  }
  const doc = await Contador.findOneAndUpdate({ _id: nombre }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return doc.seq;
}
