// Check data/network.json (and data/photos.json, if it exists) for mistakes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const network = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "network.json"), "utf-8"));
const photosPath = path.join(ROOT, "data", "photos.json");
const photos = fs.existsSync(photosPath) ? JSON.parse(fs.readFileSync(photosPath, "utf-8")) : {};

const errors = [];
const warnings = [];
const used = new Set();
const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

for (const [id, s] of Object.entries(network.stations)) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) errors.push(`station "${id}": ID must be lowercase ASCII kebab-case`);
  if (!s.name) errors.push(`station "${id}": missing name`);
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) errors.push(`station "${id}": missing x/y`);
}

for (const line of network.lines) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(line.color)) errors.push(`${line.id}: bad color "${line.color}"`);
  if (line.path.length < 2) errors.push(`${line.id}: path needs at least two entries`);
  line.path.forEach((entry, i) => {
    if (typeof entry === "string") {
      if (!network.stations[entry]) errors.push(`${line.id}: unknown station "${entry}" at position ${i}`);
      used.add(entry);
    } else if (!isPoint(entry)) {
      errors.push(`${line.id}: entry ${i} must be a station ID or [x, y]`);
    }
    if (i > 0 && JSON.stringify(entry) === JSON.stringify(line.path[i - 1])) {
      errors.push(`${line.id}: entry ${i} repeats the previous entry`);
    }
  });
  if (typeof line.path[0] !== "string" || typeof line.path.at(-1) !== "string") {
    errors.push(`${line.id}: path must start and end at a station`);
  }
}

const context = network.context || {};
for (const item of [context.ring, ...(context.water || [])].filter(Boolean)) {
  if (!Array.isArray(item.path) || item.path.length < 2) {
    errors.push(`context "${item.name}": path needs at least two entries`);
    continue;
  }
  item.path.forEach((entry, i) => {
    if (typeof entry === "string") {
      if (!network.stations[entry]) errors.push(`context "${item.name}": unknown station "${entry}" at position ${i}`);
    } else if (!isPoint(entry)) {
      errors.push(`context "${item.name}": entry ${i} must be a station ID or [x, y]`);
    }
  });
  if ("width" in item && !(item.width > 0)) errors.push(`context "${item.name}": width must be a positive number`);
}

for (const id of Object.keys(network.stations)) {
  if (!used.has(id)) errors.push(`station "${id}" is not on any line`);
}

const names = new Map();
for (const [id, s] of Object.entries(network.stations)) {
  if (names.has(s.name)) warnings.push(`"${s.name}" is used by both "${names.get(s.name)}" and "${id}"`);
  names.set(s.name, id);
}

for (const [id, list] of Object.entries(photos)) {
  if (!network.stations[id]) errors.push(`photos.json: unknown station "${id}"`);
  for (const p of list) {
    for (const file of [p.src, p.thumb]) {
      if (!fs.existsSync(path.join(ROOT, file))) errors.push(`photos.json: missing file ${file}`);
    }
  }
}

for (const line of network.lines) {
  console.log(`${line.id}: ${line.path.filter((e) => typeof e === "string").length} stations`);
}
console.log(`${Object.keys(network.stations).length} stations in total`);
for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
if (errors.length) process.exit(1);
console.log("OK");
