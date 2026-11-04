# bvg-station-signs

An interactive map of the Berlin U-Bahn (U1–U9). Click a station to see photos of its name sign.

The site is static: plain HTML, CSS, and JavaScript modules. There is no framework, nothing to build, and no backend.

## Local development

You need Node.js (see `.nvmrc`).

```bash
npm install     # installs sharp, for the photo script
npm run dev     # serves the site at http://localhost:3000
```

The page loads JavaScript modules and JSON with `fetch`. Thus, you must use a web server. Opening `index.html` directly from disk does not work.

## Add photos

1. Copy the original photos (JPEG, PNG, or WebP) into `photos-inbox/`. If you have the Google Takeout `.json` files, copy them too.
2. Name each file after its station ID, for example `alexanderplatz.jpg`. For more photos of the same station, add a number: `alexanderplatz-2.jpg`. Upper case, spaces, and umlauts are also accepted: `Möckernbrücke 2.JPG` becomes `moeckernbruecke`.
3. Run `npm run photos`.
4. Commit `photos/` and `data/photos.json`, then push.

The script does these steps:

- It checks all file names first. If a name does not match a station, it stops, suggests the nearest IDs, and processes nothing.
- It writes `photos/<id>-<n>.webp` (max. 1600 px) and `photos/<id>-<n>-thumb.webp` (max. 400 px). It applies the EXIF rotation and removes all metadata, also GPS positions. It keeps only the capture time (see below).
- It does not overwrite existing photos. New photos get the next free number.
- It moves the originals (and their `.json` files) to `photos-inbox/processed/`. Git ignores the whole `photos-inbox/` folder.
- It builds `data/photos.json` again from the contents of `photos/`.

To see all station IDs:

```bash
npm run photos -- --list
```

To remove a photo, delete its two files from `photos/` and run `npm run photos` again.

### Capture time

The viewer shows when each photo was taken, in Berlin time. The WebP file stores this time in its EXIF data (`DateTimeOriginal` and `OffsetTimeOriginal`). `npm run photos` copies it into `data/photos.json` as `takenAt`, for the browser.

The script gets the time from one of these sources, in this order:

1. The Google Takeout `.json` file of the photo (`photoTakenTime`). This is the most accurate source. It also includes date changes that you made in Google Photos.
2. The EXIF data in the original photo. If the photo has no time zone, the script uses Berlin time.

Takeout gives each photo a `.json` file with a name such as `IMG_1234.jpg.supplemental-metadata.json` (sometimes shorter, or `IMG_1234.jpg.json`). When you rename the photo, rename the `.json` file the same way. Change only the part before `.jpg`:

```
IMG_1234.jpg                                ->  alexanderplatz.jpg
IMG_1234.jpg.supplemental-metadata.json     ->  alexanderplatz.jpg.supplemental-metadata.json
```

If you do not rename the `.json` file, the script uses the EXIF data in the photo. The script output shows the source of each time. At the end, it lists the photos that have no time.

To add a time to a photo that does not have one: delete its two files from `photos/`, put the original and its `.json` file back in `photos-inbox/`, and run `npm run photos` again.

HEIC files: the prebuilt `sharp` package cannot read HEIC. Export these photos as JPEG first. (Google Photos can do this when you download.)

## Change the network

`data/network.json` contains all stations and lines.

- `stations`: one entry per physical station. The key is the station ID. `x` and `y` are positions on the schematic map. `label` is the preferred side for the name (`n`, `ne`, `e`, `se`, `s`, `sw`, `w`, `nw`). If that side is crowded, the map selects a different side.
- `lines`: each line has an ordered `path`. An entry is a station ID or an `[x, y]` bend point. Where lines use the same track (with the same two points), the map draws them side by side.

- `context`: the Ringbahn (`ring`) and the water (`water`: the Spree and the Landwehrkanal). Each has a `path` of `[x, y]` points. Water also has a line `width` and an optional `label` position. The map draws this layer below the U-Bahn lines. Visitors can hide it with the "Ringbahn / Spree & canal" checkbox. The Ringbahn is traced from the BVG map. The BVG map does not show water, so the Spree and the canal are drawn from geography and adjusted to the schematic.

Run `npm run validate` after a change. It checks for unknown IDs, stations that are not on a line, and missing photo files.

To place stations, use `tools/trace.html` (open it at `/tools/trace.html` with `npm run dev`). It shows the network on top of a reference map at `tools/berlin-map.png`. When you click, it shows the position. The reference map is the official BVG map. Git ignores it, because BVG owns the copyright.

## Deploy

GitHub Pages: in the repository settings, go to Pages and select "Deploy from a branch", `main`, `/ (root)`.

Cloudflare Pages: connect the repository. Leave the build command empty and set the output directory to `/`.
