/**
 * Carga datos de PRUEBA (ficticios) de ARISE Athletic Shop.
 *
 *   node scripts/seedDatosPrueba.js           # solo si la base está vacía
 *   node scripts/seedDatosPrueba.js --reset   # borra los datos actuales y vuelve a cargar
 *
 * Por seguridad solo se ejecuta sobre la base "DidietMaldonado".
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { conectarMongo } from '../src/db.js';
import { Producto } from '../src/models/Producto.js';
import { Categoria } from '../src/models/Categoria.js';
import { Proveedor } from '../src/models/Proveedor.js';
import { CuentaProveedor } from '../src/models/CuentaProveedor.js';
import { Cliente } from '../src/models/Cliente.js';
import { Venta } from '../src/models/Venta.js';
import { Pedido } from '../src/models/Pedido.js';
import { Oferta } from '../src/models/Oferta.js';
import { Empleado } from '../src/models/Empleado.js';
import { Nomina } from '../src/models/Nomina.js';
import { Adelanto } from '../src/models/Adelanto.js';
import { GastoAdmin } from '../src/models/GastoAdmin.js';
import { Devolucion } from '../src/models/Devolucion.js';
import { MetaAhorro } from '../src/models/MetaAhorro.js';
import { RegistroAhorro } from '../src/models/RegistroAhorro.js';
import { Usuario } from '../src/models/Usuario.js';
import { ConfigPago } from '../src/models/ConfigPago.js';

const BASE_PERMITIDA = 'DidietMaldonado';
const reset = process.argv.includes('--reset');

const MODELOS = [
  Producto, Categoria, Proveedor, CuentaProveedor, Cliente, Venta, Pedido, Oferta, Empleado,
  Nomina, Adelanto, GastoAdmin, Devolucion, MetaAhorro, RegistroAhorro, Usuario, ConfigPago,
];

// Generador pseudoaleatorio fijo para que los datos sean reproducibles
let semilla = 20261017;
const rnd = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];

const hoy = new Date();
const haceDias = (d, hora = 12) => {
  const f = new Date(hoy);
  f.setDate(f.getDate() - d);
  f.setHours(hora, entre(0, 59), 0, 0);
  return f.toISOString();
};
const lunesDe = (iso) => {
  const date = new Date(iso);
  const day = date.getDay();
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
};

const PROVEEDORES = [
  { id: 1, nombre: 'Textiles Deportivos del Bajío (prueba)', telefono: '000 000 0001', email: 'ventas@proveedor-prueba-1.test', direccion: 'Dirección de prueba 1' },
  { id: 2, nombre: 'FitGear Importaciones (prueba)', telefono: '000 000 0002', email: 'contacto@proveedor-prueba-2.test', direccion: 'Dirección de prueba 2' },
  { id: 3, nombre: 'Accesorios Pro Gym (prueba)', telefono: '000 000 0003', email: 'pedidos@proveedor-prueba-3.test', direccion: 'Dirección de prueba 3' },
];

// [nombre, categoria, precio, costo, stock, stockMinimo, proveedorId, destacado, descripcion]
const PRODUCTOS_BASE = [
  ['Playera Dry-Fit Hombre', 'Playeras', 349, 160, 40, 8, 1, true, 'Tela ligera de secado rápido para entrenamientos intensos.'],
  ['Playera Oversize Training', 'Playeras', 399, 180, 32, 6, 1, false, 'Corte oversize, algodón y poliéster con caída suelta.'],
  ['Tank Top Muscle Fit', 'Playeras', 299, 130, 25, 6, 1, false, 'Sisa amplia para máxima movilidad en el gym.'],
  ['Leggings Compresión Mujer', 'Leggings', 649, 290, 30, 6, 2, true, 'Tiro alto, compresión media y tela opaca a prueba de sentadillas.'],
  ['Leggings Seamless Sculpt', 'Leggings', 749, 340, 18, 5, 2, true, 'Tejido sin costuras con efecto moldeador.'],
  ['Short Running 2 en 1', 'Shorts', 449, 200, 28, 6, 1, false, 'Short con licra interior y bolsillo para celular.'],
  ['Short Biker Mujer', 'Shorts', 399, 170, 22, 5, 2, false, 'Largo medio, elástico y sin transparencias.'],
  ['Top Deportivo Soporte Alto', 'Tops', 499, 210, 24, 6, 2, true, 'Soporte alto para running y HIIT.'],
  ['Top Cruzado Yoga', 'Tops', 429, 180, 4, 5, 2, false, 'Espalda cruzada, soporte ligero, ideal para yoga.'],
  ['Conjunto Fitness Mujer', 'Conjuntos', 1099, 500, 12, 4, 2, true, 'Top y leggings a juego en tela suave de compresión.'],
  ['Conjunto Jogger Hombre', 'Conjuntos', 1199, 540, 10, 3, 1, false, 'Sudadera y jogger de felpa ligera.'],
  ['Sudadera Hoodie ARISE', 'Sudaderas', 899, 400, 20, 5, 1, true, 'Hoodie de felpa con capucha ajustable.'],
  ['Jogger Tech Fleece', 'Pants', 799, 360, 16, 4, 1, false, 'Jogger con puños y bolsillos con cierre.'],
  ['Shaker 700 ml', 'Accesorios', 199, 70, 50, 10, 3, false, 'Shaker con rejilla mezcladora y compartimento para polvo.'],
  ['Guantes de Entrenamiento', 'Accesorios', 279, 110, 3, 6, 3, false, 'Palma acolchada y muñequera ajustable.'],
  ['Cinturón de Levantamiento', 'Accesorios', 599, 260, 8, 3, 3, false, 'Cinturón de soporte lumbar para levantamientos pesados.'],
  ['Banda de Resistencia Set x3', 'Accesorios', 349, 120, 35, 8, 3, false, 'Tres niveles de resistencia para glúteo y pierna.'],
  ['Calcetas Deportivas Pack x3', 'Accesorios', 189, 70, 60, 12, 3, false, 'Calcetas acolchadas que absorben la humedad.'],
];

const CLIENTES = [
  { id: 1, nombre: 'Cliente Prueba Uno', telefono: '000 111 0001', email: 'cliente1@prueba.test', direccion: 'Calle Prueba 101' },
  { id: 2, nombre: 'Cliente Prueba Dos', telefono: '000 111 0002', email: 'cliente2@prueba.test', direccion: 'Calle Prueba 202' },
  { id: 3, nombre: 'Cliente Prueba Tres', telefono: '000 111 0003', email: 'cliente3@prueba.test', direccion: 'Calle Prueba 303' },
  { id: 4, nombre: 'Cliente Prueba Cuatro', telefono: '000 111 0004', email: 'cliente4@prueba.test', direccion: 'Calle Prueba 404' },
  { id: 5, nombre: 'Cliente Prueba Cinco', telefono: '000 111 0005', email: 'cliente5@prueba.test', direccion: 'Calle Prueba 505' },
];

const EMPLEADOS = [
  { id: 1, nombre: 'Empleado Prueba A', sueldo: 2500, puesto: 'Cajero' },
  { id: 2, nombre: 'Empleado Prueba B', sueldo: 2800, puesto: 'Asesor de ventas' },
  { id: 3, nombre: 'Empleado Prueba C', sueldo: 3200, puesto: 'Encargado de tienda' },
];

async function main() {
  await conectarMongo();
  const nombreBase = mongoose.connection.name;
  if (nombreBase !== BASE_PERMITIDA) {
    throw new Error(`Base conectada "${nombreBase}". Este script solo se ejecuta sobre "${BASE_PERMITIDA}".`);
  }

  const conteos = await Promise.all(MODELOS.map((m) => m.estimatedDocumentCount()));
  const hayDatos = conteos.some((c) => c > 0);
  if (hayDatos && !reset) {
    console.log('La base ya tiene datos. Usa --reset para borrarlos y volver a cargar.');
    return;
  }
  if (reset) await Promise.all(MODELOS.map((m) => m.deleteMany({})));

  // Proveedores y categorías
  await Proveedor.insertMany(PROVEEDORES);
  const categorias = [...new Set(PRODUCTOS_BASE.map((p) => p[1]))];
  await Categoria.insertMany(categorias.map((nombre) => ({ nombre })));

  // Productos
  const productos = PRODUCTOS_BASE.map(([nombre, categoria, precio, costo, stock, stockMinimo, proveedorId, destacado, descripcion], i) => ({
    id: i + 1,
    nombre,
    codigo: `ARS-${String(i + 1).padStart(4, '0')}`,
    categoria,
    precio,
    costo,
    stock,
    stockMinimo,
    estado: 'Activo',
    esGranel: false,
    proveedorId,
    descripcion,
    imagen: '',
    destacado,
  }));
  // Un producto dado de baja para probar el filtro de estado
  productos.push({
    id: productos.length + 1, nombre: 'Playera Temporada Pasada', codigo: 'ARS-9999', categoria: 'Playeras',
    precio: 249, costo: 120, stock: 0, stockMinimo: 0, estado: 'Inactivo', esGranel: false, proveedorId: 1,
    descripcion: 'Producto descontinuado (prueba).', imagen: '', destacado: false,
  });
  await Producto.insertMany(productos);
  const activos = productos.filter((p) => p.estado === 'Activo');

  // Clientes
  await Cliente.insertMany(CLIENTES);

  // Ventas de los últimos 30 días (incluye algunas a crédito)
  const ventas = [];
  for (let d = 29; d >= 0; d--) {
    const nVentas = entre(1, d === 0 ? 4 : 3);
    for (let k = 0; k < nVentas; k++) {
      const items = [];
      const usados = new Set();
      for (let j = 0; j < entre(1, 3); j++) {
        const p = elegir(activos);
        if (usados.has(p.id)) continue;
        usados.add(p.id);
        items.push({ id: p.id, nombre: p.nombre, precio: p.precio, cantidad: entre(1, 2), costo: p.costo });
      }
      const total = items.reduce((s, it) => s + it.precio * it.cantidad, 0);
      const aCredito = rnd() < 0.12;
      const cliente = aCredito || rnd() < 0.3 ? elegir(CLIENTES) : null;
      const pagado = aCredito ? Math.round(total * 0.5) : total;
      ventas.push({
        id: ventas.length + 1,
        fecha: haceDias(d, entre(10, 20)),
        items,
        total,
        pagado,
        pendiente: total - pagado,
        cliente: cliente ? cliente.nombre : 'Público general',
        clienteId: cliente ? cliente.id : undefined,
        estado: pagado >= total ? 'pagado' : 'pendiente',
      });
    }
  }
  await Venta.insertMany(ventas);

  // Devolución de prueba
  const vDev = ventas[3];
  await Devolucion.create({
    id: 1,
    fecha: haceDias(25),
    ventaId: vDev.id,
    items: [{ productoId: vDev.items[0].id, nombre: vDev.items[0].nombre, cantidad: 1, precio: vDev.items[0].precio, tipo: 'revendible' }],
  });

  // Pedidos en línea con distintos estados
  const pedidoItems = (ids) => ids.map(([id, cantidad]) => {
    const p = productos.find((x) => x.id === id);
    return { id: p.id, nombre: p.nombre, precio: p.precio, cantidad, costo: p.costo, esGranel: false, imagen: '' };
  });
  const pedidosBase = [
    { items: [[4, 1], [8, 1]], entrega: 'envio', metodoPago: 'transferencia', estadoPago: 'en_revision', estadoPedido: 'nuevo', dias: 0 },
    { items: [[1, 2], [14, 1]], entrega: 'pickup', metodoPago: 'efectivo', estadoPago: 'pendiente', estadoPedido: 'confirmado', dias: 1 },
    { items: [[10, 1]], entrega: 'envio', metodoPago: 'stripe', estadoPago: 'pagado', estadoPedido: 'preparando', dias: 2 },
    { items: [[12, 1], [13, 1]], entrega: 'envio', metodoPago: 'mercadopago', estadoPago: 'pagado', estadoPedido: 'entregado', dias: 6 },
    { items: [[6, 1]], entrega: 'pickup', metodoPago: 'transferencia', estadoPago: 'rechazado', estadoPedido: 'cancelado', dias: 9 },
  ];
  const ENVIO = 99;
  await Pedido.insertMany(pedidosBase.map((pb, i) => {
    const items = pedidoItems(pb.items);
    const subtotal = items.reduce((s, it) => s + it.precio * it.cantidad, 0);
    const envio = pb.entrega === 'envio' ? ENVIO : 0;
    const c = CLIENTES[i % CLIENTES.length];
    const fecha = haceDias(pb.dias, 11);
    return {
      id: i + 1,
      fecha,
      items,
      subtotal,
      envio,
      total: subtotal + envio,
      cliente: { nombre: c.nombre, telefono: c.telefono, email: c.email, direccion: pb.entrega === 'envio' ? c.direccion : '', referencias: '' },
      entrega: pb.entrega,
      metodoPago: pb.metodoPago,
      estadoPago: pb.estadoPago,
      estadoPedido: pb.estadoPedido,
      notas: i === 0 ? 'Pedido de prueba: talla M' : '',
      stockDescontado: pb.estadoPago === 'pagado',
      creadoEn: fecha,
      actualizadoEn: fecha,
    };
  }));

  // Ofertas (precios coherentes con el catálogo de prueba)
  const fechaHoy = hoy.toISOString().slice(0, 10);
  const enDias = (n) => { const f = new Date(hoy); f.setDate(f.getDate() + n); return f.toISOString().slice(0, 10); };
  await Oferta.insertMany([
    { id: 1, titulo: 'Combo Leggings + Top', descripcion: 'Llévate leggings de compresión y top de soporte alto a precio especial.', precioNormal: 649 + 499, precioOferta: 949, productos: ['Leggings Compresión Mujer', 'Top Deportivo Soporte Alto'], activa: true, fechaInicio: fechaHoy, fechaFin: enDias(15), creadaEn: haceDias(1) },
    { id: 2, titulo: '2 Playeras Dry-Fit', descripcion: 'Dos playeras Dry-Fit para tu semana de entrenamiento.', precioNormal: 349 * 2, precioOferta: 549, productos: ['Playera Dry-Fit Hombre'], activa: true, fechaInicio: fechaHoy, fechaFin: enDias(10), creadaEn: haceDias(2) },
    { id: 3, titulo: 'Kit Gym Esencial', descripcion: 'Shaker, guantes y calcetas para empezar con todo.', precioNormal: 199 + 279 + 189, precioOferta: 499, productos: ['Shaker 700 ml', 'Guantes de Entrenamiento', 'Calcetas Deportivas Pack x3'], activa: true, fechaInicio: fechaHoy, fechaFin: enDias(20), creadaEn: haceDias(3) },
    { id: 4, titulo: 'Hoodie de temporada (finalizada)', descripcion: 'Oferta de prueba inactiva.', precioNormal: 899, precioOferta: 699, productos: ['Sudadera Hoodie ARISE'], activa: false, fechaInicio: enDias(-40), fechaFin: enDias(-10), creadaEn: haceDias(40) },
  ]);

  // Empleados, adelanto y nóminas de las dos últimas semanas
  await Empleado.insertMany(EMPLEADOS);
  await Adelanto.create({
    id: 1, empleadoId: 2, nombre: EMPLEADOS[1].nombre, montoTotal: 1200, semanas: 4, montoPorSemana: 300,
    saldoPendiente: 900, fecha: haceDias(20), estado: 'activo',
  });
  const nominas = [];
  const gastos = [];
  [14, 7].forEach((d, i) => {
    const fecha = haceDias(d, 18);
    const items = EMPLEADOS.map((e) => ({
      empleadoId: e.id,
      nombre: e.nombre,
      monto: e.id === 2 ? e.sueldo - 300 : e.sueldo,
      diasTrabajados: 7,
      semana: lunesDe(fecha),
      adelantoDescontado: e.id === 2 ? 300 : 0,
    }));
    const total = items.reduce((s, it) => s + it.monto, 0);
    nominas.push({ id: i + 1, fecha, items, total });
    const fc = new Date(fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    gastos.push({ fecha, descripcion: `Nómina semanal (${fc})`, categoria: 'Sueldos', monto: total });
  });
  await Nomina.insertMany(nominas);

  // Gastos administrativos
  gastos.push(
    { fecha: haceDias(27), descripcion: 'Renta del local (prueba)', categoria: 'Gastos de la empresa', monto: 8500 },
    { fecha: haceDias(20), descripcion: 'Luz e internet (prueba)', categoria: 'Servicios básicos de casa', monto: 1350 },
    { fecha: haceDias(15), descripcion: 'Publicidad en redes (prueba)', categoria: 'Gastos de la empresa', monto: 1200 },
    { fecha: haceDias(8), descripcion: 'Bolsas y etiquetas (prueba)', categoria: 'Diversos', monto: 640 },
    { fecha: haceDias(3), descripcion: 'Envíos a domicilio (prueba)', categoria: 'Viáticos', monto: 450 },
  );
  await GastoAdmin.insertMany(gastos.map((g, i) => ({ id: i + 1, ...g })));

  // Cuentas con proveedores
  await CuentaProveedor.insertMany([
    { id: 1, proveedorId: 1, proveedorNombre: PROVEEDORES[0].nombre, tipo: 'deuda', fecha: haceDias(26), descripcion: 'Factura de prueba 001', monto: 12000 },
    { id: 2, proveedorId: 1, proveedorNombre: PROVEEDORES[0].nombre, tipo: 'pago', fecha: haceDias(12), descripcion: 'Abono de prueba', monto: 6000 },
    { id: 3, proveedorId: 2, proveedorNombre: PROVEEDORES[1].nombre, tipo: 'deuda', fecha: haceDias(18), descripcion: 'Factura de prueba 002', monto: 9500 },
    { id: 4, proveedorId: 3, proveedorNombre: PROVEEDORES[2].nombre, tipo: 'deuda', fecha: haceDias(10), descripcion: 'Factura de prueba 003', monto: 3200 },
    { id: 5, proveedorId: 3, proveedorNombre: PROVEEDORES[2].nombre, tipo: 'pago', fecha: haceDias(4), descripcion: 'Liquidación de prueba', monto: 3200 },
  ]);

  // Meta de ahorro con registros
  await MetaAhorro.create({ id: 1, nombre: 'Nueva colección (prueba)', meta: 30000, fechaLimite: enDias(60), estado: 'activa' });
  await RegistroAhorro.insertMany([20, 13, 6].map((d, i) => ({ metaId: 1, fecha: haceDias(d).slice(0, 10), monto: 2000 + i * 500 })));

  // Usuario de caja de prueba y configuración de pagos sin datos bancarios reales
  await Usuario.create({
    id: 1, email: 'cajero@prueba.test', password: 'prueba123', nombre: 'Cajero de prueba', telefono: '',
    permisos: { hacerVentas: true, darDeBajaProductos: false, actualizarProductos: true, borrarProductos: false },
  });
  await ConfigPago.create({ clave: 'pagos', costoEnvio: ENVIO });

  const resumen = await Promise.all(MODELOS.map(async (m) => `${m.collection.name}: ${await m.countDocuments()}`));
  console.log('\nDatos de prueba cargados en', nombreBase);
  console.log(resumen.map((r) => '  ' + r).join('\n'));
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
