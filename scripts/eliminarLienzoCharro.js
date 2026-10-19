/**
 * Elimina de la base de datos todo lo relacionado con "Lienzo Charro":
 *   - Gastos Admin con categoría "Lienzo Charro".
 *   - La colección de movimientos (movimientolienzos).
 *
 * Por defecto solo MUESTRA lo que se borraría (no modifica nada).
 * Para borrar de verdad, agrega --confirmar:
 *
 *   node scripts/eliminarLienzoCharro.js              # vista previa
 *   node scripts/eliminarLienzoCharro.js --confirmar  # borra
 *
 * Usa MONGODB_URI del archivo .env (o la variable de entorno).
 * Haz un respaldo antes de ejecutar con --confirmar: no se puede deshacer.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { conectarMongo } from '../src/db.js';
import { GastoAdmin } from '../src/models/GastoAdmin.js';

const CATEGORIA = 'Lienzo Charro';
const COLECCION = 'movimientolienzos';
const confirmar = process.argv.includes('--confirmar');

async function main() {
  await conectarMongo();
  const db = mongoose.connection.db;

  const gastos = await GastoAdmin.find({ categoria: CATEGORIA }).sort({ fecha: 1 }).lean();
  const existeColeccion = (await db.listCollections({ name: COLECCION }).toArray()).length > 0;
  const movimientos = existeColeccion ? await db.collection(COLECCION).countDocuments() : 0;

  const totalGastos = gastos.reduce((s, g) => s + (g.monto || 0), 0);
  console.log(`\nGastos Admin con categoría "${CATEGORIA}": ${gastos.length} (total $${totalGastos.toFixed(2)})`);
  gastos.forEach((g) => console.log(`  #${g.id}  ${g.fecha ?? ''}  $${g.monto}  ${g.descripcion ?? ''}`));
  console.log(`Colección "${COLECCION}": ${existeColeccion ? `${movimientos} documentos` : 'no existe'}`);

  if (!confirmar) {
    console.log('\nVista previa: no se borró nada. Ejecuta con --confirmar para eliminar.\n');
    return;
  }

  const r = await GastoAdmin.deleteMany({ categoria: CATEGORIA });
  console.log(`\nGastos eliminados: ${r.deletedCount}`);
  if (existeColeccion) {
    await db.collection(COLECCION).drop();
    console.log(`Colección "${COLECCION}" eliminada.`);
  }
  console.log('Listo.\n');
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
