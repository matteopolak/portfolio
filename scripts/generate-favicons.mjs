import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const publicDirectory = resolve(root, 'public');
const generatedDirectory = resolve(root, 'src/generated/favicons');
const sourcePath = resolve(root, 'src/assets/favicon.svg');
const source = await readFile(sourcePath);
await mkdir(generatedDirectory, { recursive: true });

async function renderPng(size) {
  return sharp(source)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeIfChanged(path, contents) {
  const output = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const current = await readFile(path).catch(() => undefined);
  if (current?.equals(output)) return false;
  await writeFile(path, output);
  return true;
}

function createIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(32, 6);
  header.writeUInt8(32, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

const [favicon32, appleTouchIcon, icon512, legacyWebp] = await Promise.all([
  renderPng(32),
  renderPng(180),
  renderPng(512),
  sharp(source).resize(512, 512).webp({ lossless: true }).toBuffer(),
]);

const outputs = [
  [resolve(generatedDirectory, 'favicon-32x32.png'), favicon32],
  [resolve(generatedDirectory, 'apple-touch-icon.png'), appleTouchIcon],
  [resolve(generatedDirectory, 'icon-512.png'), icon512],
  [resolve(publicDirectory, 'favicon.ico'), createIco(favicon32)],
  [resolve(publicDirectory, 'favicon.webp'), legacyWebp],
];

const changed = await Promise.all(
  outputs.map(([path, contents]) => writeIfChanged(path, contents))
);

console.log(
  changed.some(Boolean)
    ? 'Generated favicon assets.'
    : 'Favicon assets are current.'
);
