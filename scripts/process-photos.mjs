// Resize new photos from photos-inbox/ into photos/ and rebuild data/photos.json.
//
// Name each file after its station ID, for example alexanderplatz.jpg or alexanderplatz-2.jpg.
// Run `npm run photos -- --list` to see all station IDs.
//
// The capture time comes from the Google Takeout sidecar file (alexanderplatz.jpg.json or
// alexanderplatz.jpg.supplemental-metadata.json), or else from the EXIF data in the photo.
// It is written into the WebP as EXIF DateTimeOriginal + OffsetTimeOriginal (Berlin time).
// No other metadata is kept.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INBOX = path.join(ROOT, "photos-inbox");
const DONE = path.join(INBOX, "processed");
const PHOTOS = path.join(ROOT, "photos");
const NETWORK = path.join(ROOT, "data", "network.json");
const MANIFEST = path.join(ROOT, "data", "photos.json");

const FULL_SIZE = 1600;
const THUMB_SIZE = 400;
const QUALITY = 80;
const INPUT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".tif", ".tiff"]);
const OUTPUT_PATTERN = /^([a-z0-9-]+)-(\d+)(-thumb)?\.webp$/;
const TIME_ZONE = "Europe/Berlin";

const network = JSON.parse(fs.readFileSync(NETWORK, "utf-8"));
const stationIds = Object.keys(network.stations);

// "Möckernbrücke 2.JPG" -> "moeckernbruecke-2"
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Accept "<station-id>" or "<station-id>-<number>".
function stationIdFor(fileName) {
  const base = normalize(path.parse(fileName).name);
  if (network.stations[base]) return base;
  const match = base.match(/^(.+?)-\d+$/);
  if (match && network.stations[match[1]]) return match[1];
  return null;
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function suggestions(fileName) {
  const base = normalize(path.parse(fileName).name).replace(/-\d+$/, "");
  return stationIds
    .map((id) => ({ id, score: id.includes(base) || base.includes(id) ? 0 : levenshtein(base, id) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((s) => s.id);
}

// --- Capture time -------------------------------------------------------------------------

// Read DateTimeOriginal and OffsetTimeOriginal from a raw EXIF (TIFF) block, as returned by
// sharp's metadata().exif.
function readExifDate(exif) {
  if (!exif) return null;
  let buf = exif;
  if (buf.subarray(0, 6).toString("latin1") === "Exif\0\0") buf = buf.subarray(6);
  if (buf.length < 8) return null;
  const le = buf.toString("latin1", 0, 2) === "II";
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  function readIfd(offset) {
    const tags = {};
    if (offset + 2 > buf.length) return tags;
    const count = u16(offset);
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12;
      if (e + 12 > buf.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      if (type === 2) {
        const at = n <= 4 ? e + 8 : u32(e + 8);
        tags[tag] = buf.toString("latin1", at, at + n).replace(/\0.*$/s, "").trim();
      } else if (type === 4) {
        tags[tag] = u32(e + 8);
      }
    }
    return tags;
  }

  try {
    const ifd0 = readIfd(u32(4));
    if (!ifd0[0x8769]) return null;
    const exifIfd = readIfd(ifd0[0x8769]);
    const dateTime = exifIfd[0x9003];
    if (!/^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/.test(dateTime || "")) return null;
    const offset = /^[+-]\d\d:\d\d$/.test(exifIfd[0x9011] || "") ? exifIfd[0x9011] : null;
    return { dateTime, offset };
  } catch {
    return null;
  }
}

const berlinFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

// A Date as Berlin local time: { dateTime: "2024:05:03 14:22:10", offset: "+02:00" }
function toBerlinExif(date) {
  const p = Object.fromEntries(berlinFormat.formatToParts(date).map((x) => [x.type, x.value]));
  const offset = p.timeZoneName.replace("GMT", "") || "+00:00";
  return { dateTime: `${p.year}:${p.month}:${p.day} ${p.hour}:${p.minute}:${p.second}`, offset };
}

// EXIF date (with or without offset) to a Date. Without an offset, assume Berlin local time.
function fromExif({ dateTime, offset }) {
  const iso = dateTime.replace(/^(\d{4}):(\d\d):(\d\d) /, "$1-$2-$3T");
  if (offset) return new Date(`${iso}${offset}`);
  const asUtc = new Date(`${iso}Z`);
  const offsetMinutes = (d) => {
    const [, sign, h, m] = toBerlinExif(d).offset.match(/([+-])(\d\d):(\d\d)/);
    return (sign === "-" ? -1 : 1) * (Number(h) * 60 + Number(m));
  };
  let guess = new Date(asUtc - offsetMinutes(asUtc) * 60000);
  guess = new Date(asUtc - offsetMinutes(guess) * 60000);
  return guess;
}

// Find the Takeout sidecar for an image. Takeout uses names such as "IMG_1.jpg.json",
// "IMG_1.jpg.supplemental-metadata.json" (sometimes cut short), and for duplicates
// "IMG_1(1).jpg" -> "IMG_1.jpg.supplemental-metadata(1).json".
function findSidecar(file, jsonFiles) {
  const lower = file.toLowerCase();
  const dup = lower.match(/^(.*)\((\d+)\)(\.[^.]+)$/);
  const matches = jsonFiles.filter((j) => {
    const jl = j.toLowerCase();
    return dup ? jl.startsWith(`${dup[1]}${dup[3]}`) && jl.endsWith(`(${dup[2]}).json`) : jl.startsWith(`${lower}.`);
  });
  return matches.sort((a, b) => a.length - b.length)[0] || null;
}

function readSidecarDate(sidecarPath) {
  try {
    const data = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
    const seconds = Number(data?.photoTakenTime?.timestamp);
    return seconds > 0 ? new Date(seconds * 1000) : null;
  } catch {
    return null;
  }
}

const displayFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE });

// --- Files ---------------------------------------------------------------------------------

function existingPhotos() {
  if (!fs.existsSync(PHOTOS)) return [];
  return fs
    .readdirSync(PHOTOS)
    .map((file) => file.match(OUTPUT_PATTERN))
    .filter((m) => m && !m[3])
    .map((m) => ({ id: m[1], n: Number(m[2]), file: m[0] }));
}

async function rebuildManifest() {
  const byStation = {};
  const photos = existingPhotos().sort((a, b) => a.id.localeCompare(b.id) || a.n - b.n);
  for (const { id, n, file } of photos) {
    if (!network.stations[id]) {
      console.warn(`! photos/${file}: unknown station "${id}", skipped`);
      continue;
    }
    const thumbFile = `${id}-${n}-thumb.webp`;
    const [full, thumb] = await Promise.all([
      sharp(path.join(PHOTOS, file)).metadata(),
      sharp(path.join(PHOTOS, thumbFile)).metadata(),
    ]);
    // The capture time is stored in the WebP itself. Copy it to the manifest for the browser.
    const taken = readExifDate(full.exif);
    (byStation[id] ||= []).push({
      src: `photos/${file}`,
      width: full.width,
      height: full.height,
      thumb: `photos/${thumbFile}`,
      thumbWidth: thumb.width,
      ...(taken && {
        takenAt: `${taken.dateTime.replace(/^(\d{4}):(\d\d):(\d\d) /, "$1-$2-$3T")}${taken.offset || ""}`,
      }),
    });
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(byStation, null, 2) + "\n");
  return byStation;
}

function printStationList() {
  const rows = Object.entries(network.stations)
    .map(([id, s]) => [id, s.name])
    .sort(([a], [b]) => a.localeCompare(b));
  const width = Math.max(...rows.map(([id]) => id.length));
  for (const [id, name] of rows) console.log(`${id.padEnd(width)}  ${name}`);
}

async function main() {
  if (process.argv.includes("--list")) {
    printStationList();
    return;
  }

  fs.mkdirSync(INBOX, { recursive: true });
  fs.mkdirSync(PHOTOS, { recursive: true });

  const inboxFiles = fs
    .readdirSync(INBOX, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
  const files = inboxFiles.filter((name) => INPUT_EXTENSIONS.has(path.extname(name).toLowerCase()));
  const jsonFiles = inboxFiles.filter((name) => name.toLowerCase().endsWith(".json"));

  // Check every file name before processing anything.
  const plan = [];
  const errors = [];
  for (const file of files) {
    const id = stationIdFor(file);
    if (id) plan.push({ file, id });
    else errors.push(`  ${file}  (did you mean: ${suggestions(file).join(", ")}?)`);
  }
  // Keep the order of the file names: "x.jpg" before "x-2.jpg" before "x-10.jpg".
  const suffix = (file) => Number(normalize(path.parse(file).name).match(/-(\d+)$/)?.[1] ?? 0);
  plan.sort((a, b) => a.id.localeCompare(b.id) || suffix(a.file) - suffix(b.file));

  if (errors.length) {
    console.error(`These files do not match a station ID:\n${errors.join("\n")}`);
    console.error("\nRename them and run again. Nothing was processed. Use --list to see all IDs.");
    process.exit(1);
  }

  const next = {};
  for (const { id, n } of existingPhotos()) next[id] = Math.max(next[id] || 1, n + 1);

  if (plan.length) fs.mkdirSync(DONE, { recursive: true });
  const undated = [];
  for (const { file, id } of plan) {
    const n = next[id] || 1;
    next[id] = n + 1;
    const input = path.join(INBOX, file);
    const out = path.join(PHOTOS, `${id}-${n}.webp`);
    const outThumb = path.join(PHOTOS, `${id}-${n}-thumb.webp`);

    const sidecar = findSidecar(file, jsonFiles);
    let taken = null;
    let source = "";

    try {
      // rotate() applies the EXIF orientation. sharp drops all metadata (also GPS) by default.
      const image = sharp(input).rotate();

      const fromSidecar = sidecar && readSidecarDate(path.join(INBOX, sidecar));
      const fromPhoto = !fromSidecar && readExifDate((await image.metadata()).exif);
      if (fromSidecar) {
        taken = fromSidecar;
        source = "Takeout JSON";
      } else if (fromPhoto) {
        taken = fromExif(fromPhoto);
        source = "photo EXIF";
      }

      let full = image
        .clone()
        .resize(FULL_SIZE, FULL_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY });
      if (taken) {
        // Write only the capture time. withExif() ignores all EXIF in the input (also GPS).
        const { dateTime, offset } = toBerlinExif(taken);
        full = full.withExif({ IFD2: { DateTimeOriginal: dateTime, OffsetTimeOriginal: offset } });
      }
      await full.toFile(out);
      await image
        .clone()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(outThumb);
    } catch (error) {
      fs.rmSync(out, { force: true });
      fs.rmSync(outThumb, { force: true });
      const heic = /\.hei[cf]$/i.test(file);
      console.error(`✗ ${file}: ${error.message}`);
      if (heic) console.error("  This sharp build cannot read HEIC. Export the photo as JPEG and try again.");
      process.exitCode = 1;
      continue;
    }

    fs.renameSync(input, path.join(DONE, file));
    if (sidecar) fs.renameSync(path.join(INBOX, sidecar), path.join(DONE, sidecar));
    if (!taken) undated.push(file);
    const when = taken ? `taken ${displayFormat.format(taken)}, from ${source}` : "no capture time found";
    console.log(`✓ ${file} -> photos/${id}-${n}.webp (${when})`);
  }

  const manifest = await rebuildManifest();
  const covered = Object.keys(manifest).length;
  const total = Object.values(manifest).reduce((sum, list) => sum + list.length, 0);
  console.log(
    `\n${plan.length ? `Added ${plan.length} photo(s). ` : "No new photos in photos-inbox/. "}` +
      `${total} photos, ${covered} of ${stationIds.length} stations covered.`
  );
  if (undated.length) {
    console.warn(
      `\n! No capture time for: ${undated.join(", ")}\n` +
        '  To add it, see "Capture time" in README.md.'
    );
  }
}

main();
