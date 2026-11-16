import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { armarEscPos, comandosNegrita, decodificarPng1Bit, encabezadoLogo, logoEscPos } from '../src/imprimirTicket.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tickets');
const png80 = fs.readFileSync(path.join(dir, 'pollito-mixteco-ticket-80mm.png'));
const png58 = fs.readFileSync(path.join(dir, 'pollito-mixteco-ticket-58mm.png'));
const dataUrl = (b) => 'data:image/png;base64,' + b.toString('base64');

/** Como se armaba el ticket antes del logo. */
function anterior(texto) {
  const body = Buffer.from(String(texto).replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'latin1');
  return Buffer.concat([body, Buffer.from('\n\n\n\n', 'ascii'), Buffer.from([0x1b, 0x64, 0x01])]);
}

test('sin logo ni negrita el ticket es idéntico al de antes', () => {
  const texto = 'EL POLLITO MIXTECO\nTOTAL   $10.00';
  assert.deepEqual(armarEscPos(texto, null, { negrita: false }), anterior(texto));
  assert.equal(encabezadoLogo('', 'X', 'escpos'), null);
});

test('la negrita envuelve todo el texto (Star: ESC E ... ESC F)', () => {
  const texto = 'TOTAL   $10.00';
  const t = armarEscPos(texto, null, { negrita: true, modo: 'star' });
  assert.deepEqual([...t.subarray(0, 2)], [0x1b, 0x45]);
  assert.equal(t.subarray(2, 2 + texto.length).toString('latin1'), texto);
  assert.deepEqual([...t.subarray(2 + texto.length, 4 + texto.length)], [0x1b, 0x46]);
  // El resto (avance y corte) queda igual que antes.
  assert.deepEqual(t.subarray(4 + texto.length), anterior('').subarray(0));
});

test('en ESC/POS la negrita es ESC E 1 / ESC E 0', () => {
  const { activar, desactivar } = comandosNegrita('escpos');
  assert.deepEqual([...activar], [0x1b, 0x45, 1]);
  assert.deepEqual([...desactivar], [0x1b, 0x45, 0]);
});

test('con logo (ESC/POS) el ticket empieza con ESC @, ESC a 1 y GS v 0', () => {
  const enc = encabezadoLogo(dataUrl(png80), 'EL POLLITO MIXTECO', 'escpos');
  const ticket = armarEscPos('hola', enc, { negrita: false });
  // ESC @ | ESC a 1 | GS v 0 m=0 | xL xH = 72 bytes (576 px) | yL yH = 441
  assert.deepEqual([...ticket.subarray(0, 13)], [0x1b, 0x40, 0x1b, 0x61, 1, 0x1d, 0x76, 0x30, 0, 72, 0, 441 & 0xff, 441 >> 8]);
  const finLogo = 13 + 72 * 441;
  assert.deepEqual([...ticket.subarray(finLogo, finLogo + 4)], [0x0a, 0x1b, 0x61, 0]);
  assert.equal(ticket.subarray(finLogo + 4, finLogo + 8).toString('latin1'), 'hola');
});

test('los PNG se leen con su tamaño y se convierten sin invertir de más', () => {
  const d58 = decodificarPng1Bit(png58);
  assert.equal(d58.ancho, 384);
  assert.equal(d58.alto, 300);
  const d80 = decodificarPng1Bit(png80);
  assert.equal(d80.ancho, 576);
  // La esquina superior izquierda es papel (blanco): en el PNG vale 1 y en el raster 0 (sin tinta).
  assert.equal(d80.filas[0][0], 0xff);
  assert.equal(logoEscPos(png80)[13], 0x00);
});

test('el logo convertido se guarda en caché', () => {
  const url = dataUrl(png58);
  assert.equal(encabezadoLogo(url, 'X', 'escpos'), encabezadoLogo(url, 'X', 'escpos'));
});

test('si la imagen falla o la impresora está en modo Star se imprime el nombre en texto', () => {
  const malo = encabezadoLogo('data:image/png;base64,AAAA', 'EL POLLITO MIXTECO', 'escpos');
  assert.ok(malo.toString('latin1').includes('EL POLLITO MIXTECO'));
  const star = encabezadoLogo(dataUrl(png80), 'EL POLLITO MIXTECO', 'star');
  assert.ok(star.toString('latin1').includes('EL POLLITO MIXTECO'));
  assert.ok(!star.includes(Buffer.from([0x1d, 0x76, 0x30])));
});
