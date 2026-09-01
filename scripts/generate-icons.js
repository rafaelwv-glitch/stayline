#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZES = [16, 32, 48, 64, 128, 256, 512];
const OUT = path.join(__dirname, "..", "assets", "icons");

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function writePng(file, size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size);
      const o = row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function inRoundRect(x, y, rx, ry, rw, rh, rad) {
  const cx = Math.min(Math.max(x, rx + rad), rx + rw - rad);
  const cy = Math.min(Math.max(y, ry + rad), ry + rh - rad);
  if (x >= rx + rad && x <= rx + rw - rad && y >= ry && y <= ry + rh) return true;
  if (y >= ry + rad && y <= ry + rh - rad && x >= rx && x <= rx + rw) return true;
  return dist(x, y, cx, cy) <= rad;
}

function paint(x, y, size) {
  const s = size / 32;
  const bg = [10, 11, 13, 255];
  const ink = [197, 204, 196, 255];
  const green = [61, 204, 122, 255];
  if (inRoundRect(x, y, 0, 0, size, size, 6 * s)) {
    // shackle
    const cx = 16 * s;
    const cy = 11 * s;
    const outer = 5.6 * s;
    const inner = 3.1 * s;
    const d = dist(x, y, cx, cy);
    if (y <= 14.4 * s && d <= outer && d >= inner) return ink;
    if (inRoundRect(x, y, 8.5 * s, 14 * s, 15 * s, 11.5 * s, 2.4 * s)) return ink;
    if (dist(x, y, 23.2 * s, 9.2 * s) <= 3.1 * s) return green;
    return bg;
  }
  return [0, 0, 0, 0];
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  writePng(path.join(OUT, `${size}x${size}.png`), size, paint);
}
fs.copyFileSync(path.join(OUT, "512x512.png"), path.join(OUT, "icon.png"));
console.log("icons written to", OUT);
