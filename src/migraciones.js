import { Usuario } from './models/Usuario.js';
import { Venta } from './models/Venta.js';
import { esHash, hashPassword } from './auth.js';

/**
 * Correcciones de datos que se ejecutan al iniciar el servidor. Son idempotentes:
 * si ya se aplicaron no hacen nada.
 */
export async function migrarDatos() {
  // 1) Contraseñas guardadas en texto plano → hash scrypt.
  const usuarios = await Usuario.find({ password: { $not: /^scrypt\$/ } });
  for (const u of usuarios) {
    if (esHash(u.password)) continue;
    u.password = await hashPassword(u.password);
    await u.save();
  }
  if (usuarios.length) console.log(`[migración] ${usuarios.length} contraseña(s) de usuario cifradas`);

  // 2) Ventas antiguas que guardaron el dinero recibido incluyendo el cambio (pagado > total)
  //    o un pagado inválido (NaN). El cambio no es ingreso del negocio.
  //    Se usa la colección directa porque Mongoose no permite consultar ni guardar NaN.
  const ventas = await Venta.collection
    .find({
      estado: { $ne: 'cancelada' },
      $or: [{ $expr: { $gt: ['$pagado', '$total'] } }, { pagado: NaN }, { pendiente: NaN }, { total: NaN }],
    })
    .toArray();
  for (const v of ventas) {
    const total = Number.isFinite(v.total) ? v.total : (v.items || []).reduce((s, it) => s + (it.precio || 0) * (it.cantidad || 0), 0);
    let pagado = Number(v.pagado);
    if (!Number.isFinite(pagado)) pagado = v.estado === 'pagado' ? total : 0;
    pagado = Math.min(pagado, total);
    const pendiente = Math.max(0, Math.round((total - pagado) * 100) / 100);
    await Venta.collection.updateOne(
      { _id: v._id },
      { $set: { total, pagado, pendiente, estado: pendiente <= 0 ? 'pagado' : 'pendiente' } }
    );
  }
  if (ventas.length) console.log(`[migración] ${ventas.length} venta(s) corregidas (cambio contado como pago o pago inválido)`);
}
