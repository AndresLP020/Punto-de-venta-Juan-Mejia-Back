import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promisify } from 'util';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'raw-print.ps1');

/**
 * Modo de comandos de la impresora: 'star' (la OKI POS407II sale de fábrica en modo Star, DIP 1-1 ON)
 * o 'escpos'. Solo en ESC/POS se imprime el logo como imagen (GS v 0).
 */
const MODO_IMPRESORA = (process.env.PRINTER_MODE || 'star').toLowerCase() === 'escpos' ? 'escpos' : 'star';

const ESC = 0x1b;
const GS = 0x1d;

/** Letra enfatizada (negrita) en todo el ticket. Se puede apagar con TICKET_NEGRITA=0. */
const NEGRITA = process.env.TICKET_NEGRITA !== '0';

/** Comandos para activar / desactivar la letra enfatizada según el modo de la impresora. */
export function comandosNegrita(modo = MODO_IMPRESORA) {
  if (modo === 'escpos') return { activar: Buffer.from([ESC, 0x45, 1]), desactivar: Buffer.from([ESC, 0x45, 0]) }; // ESC E n
  return { activar: Buffer.from([ESC, 0x45]), desactivar: Buffer.from([ESC, 0x46]) }; // Star: ESC E / ESC F
}

/**
 * En Star, ESC d n corta el papel: n=1 corte parcial (recomendado en horizontal).
 * `encabezado` (opcional) son los bytes del logo que van antes del texto.
 * Con `negrita` todo el texto sale enfatizado para que se vea más oscuro.
 */
export function armarEscPos(texto, encabezado = null, { negrita = NEGRITA, modo = MODO_IMPRESORA } = {}) {
  const body = Buffer.from(String(texto ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'latin1');
  const feed = Buffer.from('\n\n\n\n', 'ascii');
  const cutStar = Buffer.from([0x1b, 0x64, 0x01]);
  const partes = [];
  if (encabezado) partes.push(encabezado);
  if (negrita) {
    const { activar, desactivar } = comandosNegrita(modo);
    partes.push(activar, body, desactivar);
  } else partes.push(body);
  partes.push(feed, cutStar);
  return Buffer.concat(partes);
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

/**
 * Decodifica un PNG en escala de grises de 1 bit (el formato de los logos para térmica) y devuelve
 * las filas empaquetadas tal cual vienen (1 = blanco). Otros formatos lanzan error.
 */
export function decodificarPng1Bit(buf) {
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(firma)) throw new Error('El logo no es un PNG');
  let pos = 8;
  let ancho = 0;
  let alto = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const tipo = buf.toString('ascii', pos + 4, pos + 8);
    const datos = buf.subarray(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') {
      ancho = datos.readUInt32BE(0);
      alto = datos.readUInt32BE(4);
      const bits = datos[8];
      const color = datos[9];
      const entrelazado = datos[12];
      if (bits !== 1 || color !== 0 || entrelazado !== 0) {
        throw new Error(`El logo debe ser PNG de 1 bit en escala de grises sin entrelazar (bits=${bits}, color=${color})`);
      }
    } else if (tipo === 'IDAT') idat.push(datos);
    else if (tipo === 'IEND') break;
    pos += 12 + len;
  }
  if (!ancho || !alto) throw new Error('PNG sin encabezado válido');
  const crudo = zlib.inflateSync(Buffer.concat(idat));
  const bytesFila = Math.ceil(ancho / 8);
  const filas = [];
  let anterior = Buffer.alloc(bytesFila);
  for (let y = 0; y < alto; y += 1) {
    const inicio = y * (bytesFila + 1);
    const filtro = crudo[inicio];
    const fila = Buffer.from(crudo.subarray(inicio + 1, inicio + 1 + bytesFila));
    for (let x = 0; x < bytesFila; x += 1) {
      const a = x > 0 ? fila[x - 1] : 0; // bpp = 1 byte para 1 bit por píxel
      const b = anterior[x];
      const c = x > 0 ? anterior[x - 1] : 0;
      let suma = 0;
      if (filtro === 1) suma = a;
      else if (filtro === 2) suma = b;
      else if (filtro === 3) suma = (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        suma = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filtro !== 0) throw new Error(`Filtro PNG desconocido: ${filtro}`);
      fila[x] = (fila[x] + suma) & 0xff;
    }
    filas.push(fila);
    anterior = fila;
  }
  return { ancho, alto, bytesFila, filas };
}

/**
 * Bloque ESC/POS con el logo: ESC @ → ESC a 1 (centrar) → GS v 0 (imagen raster) → salto → ESC a 0.
 * En el PNG 1 = blanco; en GS v 0 1 = punto negro, por eso se invierten los bits (sin dithering ni recorte).
 */
export function logoEscPos(png) {
  const { ancho, alto, bytesFila, filas } = decodificarPng1Bit(png);
  const sobrantes = bytesFila * 8 - ancho; // bits de relleno al final de cada fila: se dejan en blanco
  const mascaraFinal = sobrantes ? (0xff << sobrantes) & 0xff : 0xff;
  const datos = Buffer.alloc(bytesFila * alto);
  filas.forEach((fila, y) => {
    for (let x = 0; x < bytesFila; x += 1) {
      let v = ~fila[x] & 0xff;
      if (x === bytesFila - 1) v &= mascaraFinal;
      datos[y * bytesFila + x] = v;
    }
  });
  return Buffer.concat([
    Buffer.from([ESC, 0x40, ESC, 0x61, 1]),
    Buffer.from([GS, 0x76, 0x30, 0x00, bytesFila & 0xff, bytesFila >> 8, alto & 0xff, alto >> 8]),
    datos,
    Buffer.from([0x0a, ESC, 0x61, 0]),
  ]);
}

/** Respaldo cuando no se puede imprimir la imagen: el nombre centrado en doble alto. */
export function logoTexto(nombre, modo = MODO_IMPRESORA) {
  const t = Buffer.from(nombre, 'latin1');
  if (modo === 'escpos') {
    // ESC @, ESC a 1 (centrar), GS ! 0x01 (doble alto) ... GS ! 0, ESC a 0
    return Buffer.concat([Buffer.from([ESC, 0x40, ESC, 0x61, 1, GS, 0x21, 0x01]), t, Buffer.from([0x0a, GS, 0x21, 0, ESC, 0x61, 0])]);
  }
  // Star: ESC @, ESC GS a 1 (centrar), ESC h 1 (doble alto) ... ESC h 0, ESC GS a 0
  return Buffer.concat([Buffer.from([ESC, 0x40, ESC, GS, 0x61, 1, ESC, 0x68, 1]), t, Buffer.from([0x0a, ESC, 0x68, 0, ESC, GS, 0x61, 0])]);
}

/** Caché de logos ya convertidos (clave: hash del data URL), para no convertir en cada impresión. */
const cacheLogos = new Map();

/**
 * Bytes del encabezado con el logo para la impresión directa. Nunca lanza: si la impresora no
 * soporta imágenes o el PNG falla, devuelve el nombre en texto y deja el error en el log.
 */
export function encabezadoLogo(dataUrl, nombreRespaldo, modo = MODO_IMPRESORA) {
  if (!dataUrl) return null;
  if (modo !== 'escpos') {
    if (!cacheLogos.has('aviso-star')) {
      cacheLogos.set('aviso-star', true);
      console.warn('[ticket] La impresora está en modo Star: el logo se imprime como texto. Usa PRINTER_MODE=escpos para imprimirlo como imagen.');
    }
    return logoTexto(nombreRespaldo, modo);
  }
  const clave = createHash('sha1').update(dataUrl).digest('hex');
  if (!cacheLogos.has(clave)) {
    try {
      const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
      cacheLogos.set(clave, logoEscPos(png));
    } catch (err) {
      console.error('[ticket] No se pudo convertir el logo, se imprime el nombre en texto:', err.message);
      cacheLogos.set(clave, logoTexto(nombreRespaldo, modo));
    }
  }
  return cacheLogos.get(clave);
}

export async function imprimirRawEnWindows(buffer, printerName = process.env.PRINTER_NAME || 'POS-80') {
  if (process.platform !== 'win32') {
    throw new Error('La impresora solo está disponible en el equipo local (Windows).');
  }
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Printer', printerName, '-Base64', buffer.toString('base64')],
    { windowsHide: true, timeout: 20000 }
  );
  if (stderr && /throw|error|fallo/i.test(stderr)) {
    throw new Error(stderr.trim());
  }
  return (stdout || '').trim();
}
