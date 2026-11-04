const SVG_NS = "http://www.w3.org/2000/svg";
const LINE_WIDTH = 4.5;
const LINE_GAP = 5; // distance between parallel lines on shared track
const LABEL_SIZE = 9;

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// A path entry is either a station id or an [x, y] bend point.
function pointOf(entry, stations) {
  if (Array.isArray(entry)) return { x: entry[0], y: entry[1] };
  return stations[entry];
}

const keyOf = (p) => `${p.x},${p.y}`;

function segmentKey(a, b) {
  const ka = keyOf(a);
  const kb = keyOf(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

// Find which lines share each track segment, so parallel lines can be drawn side by side.
function collectSharedSegments(lines, stations) {
  const shared = new Map();
  for (const line of lines) {
    for (let i = 0; i < line.path.length - 1; i++) {
      const key = segmentKey(pointOf(line.path[i], stations), pointOf(line.path[i + 1], stations));
      if (!shared.has(key)) shared.set(key, []);
      if (!shared.get(key).includes(line.id)) shared.get(key).push(line.id);
    }
  }
  return shared;
}

function offsetSegment(a, b, lineId, shared) {
  const key = segmentKey(a, b);
  const group = shared.get(key);
  const offset = (group.indexOf(lineId) - (group.length - 1) / 2) * LINE_GAP;
  // Use a fixed direction per segment, so every line in a group offsets to the same side.
  const [p, q] = keyOf(a) < keyOf(b) ? [a, b] : [b, a];
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const nx = -(q.y - p.y) / len;
  const ny = (q.x - p.x) / len;
  return {
    a: { x: a.x + nx * offset, y: a.y + ny * offset },
    b: { x: b.x + nx * offset, y: b.y + ny * offset },
  };
}

function intersect(s1, s2) {
  const d1x = s1.b.x - s1.a.x;
  const d1y = s1.b.y - s1.a.y;
  const d2x = s2.b.x - s2.a.x;
  const d2y = s2.b.y - s2.a.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((s2.a.x - s1.a.x) * d2y - (s2.a.y - s1.a.y) * d2x) / denom;
  return { x: s1.a.x + t * d1x, y: s1.a.y + t * d1y };
}

// Returns the drawn points of a line, plus where the line passes each node in its path.
function offsetLine(line, stations, shared) {
  const nodes = line.path.map((entry) => pointOf(entry, stations));
  const segs = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    segs.push(offsetSegment(nodes[i], nodes[i + 1], line.id, shared));
  }

  const points = [segs[0].a];
  const atNode = [segs[0].a];
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1];
    const next = segs[i];
    const hit = intersect(prev, next);
    if (hit && Math.hypot(hit.x - nodes[i].x, hit.y - nodes[i].y) < LINE_GAP * 3) {
      points.push(hit);
      atNode.push(hit);
    } else {
      // Parallel segments with a different offset: step across.
      points.push(prev.b, next.a);
      atNode.push({ x: (prev.b.x + next.a.x) / 2, y: (prev.b.y + next.a.y) / 2 });
    }
  }
  const last = segs[segs.length - 1].b;
  points.push(last);
  atNode.push(last);
  return { points, atNode };
}

// Label placement: each station tries 8 directions, in one or two text lines, and keeps the
// position with the fewest collisions. station.label in network.json is the preferred direction.
const DIRECTIONS = { e: [1, 0], w: [-1, 0], ne: [1, -1], se: [1, 1], nw: [-1, -1], sw: [-1, 1], n: [0, -1], s: [0, 1] };
const ASCENT = 0.72 * LABEL_SIZE;
const LINE_HEIGHT = 1.1 * LABEL_SIZE;
const COST = { line: 2, context: 0.4, marker: 6, label: 12, ambiguous: 5, wrap: 1.5, notPreferred: 0.6 };

// Break a long name into two lines near the middle, at a hyphen, slash, or space.
function wrapName(name) {
  let best = null;
  for (let i = 1; i < name.length - 1; i++) {
    const ch = name[i];
    if (ch !== "-" && ch !== " ") continue;
    const first = name.slice(0, ch === "-" ? i + 1 : i).replace(/ \/$/, "");
    const second = name.slice(i + 1).replace(/^\/ /, "");
    const score = Math.max(first.length, second.length);
    if (!best || score < best.score) best = { score, lines: [first, second] };
  }
  return best && best.score < name.length - 3 ? best.lines : null;
}

// Liang-Barsky test: does the segment p-q cross the rectangle?
function segmentHitsRect(p, q, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const checks = [
    [-dx, p.x - r.x1],
    [dx, r.x2 - p.x],
    [-dy, p.y - r.y1],
    [dy, r.y2 - p.y],
  ];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return false;
    } else {
      const t = qq / pp;
      if (pp < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function distanceToRect(p, r) {
  const dx = Math.max(r.x1 - p.x, 0, p.x - r.x2);
  const dy = Math.max(r.y1 - p.y, 0, p.y - r.y2);
  return Math.hypot(dx, dy);
}

const inflate = (r, d) => ({ x1: r.x1 - d, y1: r.y1 - d, x2: r.x2 + d, y2: r.y2 + d });
const rectsOverlap = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

function labelCandidates(name, marker, widthOf, preferred) {
  const { a, b, r } = marker;
  const box = {
    x1: Math.min(a.x, b.x) - r,
    x2: Math.max(a.x, b.x) + r,
    y1: Math.min(a.y, b.y) - r,
    y2: Math.max(a.y, b.y) + r,
  };
  const variants = [[name]];
  const wrapped = wrapName(name);
  if (wrapped) variants.push(wrapped);

  const out = [];
  for (const textLines of variants) {
    const w = Math.max(...textLines.map(widthOf));
    const h = ASCENT + (textLines.length - 1) * LINE_HEIGHT;
    for (const [dir, [ux, uy]] of Object.entries(DIRECTIONS)) {
      const gap = ux && uy ? 1.5 : 3;
      const ax = ux > 0 ? box.x2 + gap : ux < 0 ? box.x1 - gap : (box.x1 + box.x2) / 2;
      const ay = uy > 0 ? box.y2 + gap : uy < 0 ? box.y1 - gap : (box.y1 + box.y2) / 2;
      const x1 = ux > 0 ? ax : ux < 0 ? ax - w : ax - w / 2;
      const y1 = uy > 0 ? ay : uy < 0 ? ay - h : ay - h / 2;
      out.push({
        rect: { x1, y1, x2: x1 + w, y2: y1 + h },
        lines: textLines,
        anchor: ux > 0 ? "start" : ux < 0 ? "end" : "middle",
        x: ax,
        y: y1 + ASCENT,
        base: (dir === preferred ? 0 : COST.notPreferred) + (textLines.length > 1 ? COST.wrap : 0),
      });
    }
  }
  return out;
}

const RING_WIDTH = 4;

const toPoints = (pts) => pts.map((p) => `${p.x},${p.y}`).join(" ");

// Ringbahn and water, drawn below the U-Bahn lines. Returns their segments for label placement.
// Path entries are [x, y] points or station IDs, the same as in line paths.
function renderContext(layer, context = {}, stations) {
  const segments = [];
  const resolve = (path) => {
    const pts = path.map((entry) => pointOf(entry, stations));
    for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]]);
    return pts;
  };

  for (const water of context.water || []) {
    el("polyline", { points: toPoints(resolve(water.path)), class: "water", "stroke-width": water.width }, layer);
    if (water.label) {
      const { x, y, angle = 0 } = water.label;
      const text = el(
        "text",
        { x, y, class: "water-label", "text-anchor": "middle", transform: `rotate(${angle} ${x} ${y})` },
        layer
      );
      text.textContent = water.name;
    }
  }

  if (context.ring) {
    // Double dashed line: a wide dashed black stroke, with a narrow background stroke on top.
    const points = toPoints(resolve(context.ring.path));
    el("polyline", { points, class: "ring-outer", "stroke-width": RING_WIDTH }, layer);
    el("polyline", { points, class: "ring-inner", "stroke-width": RING_WIDTH - 2.4 }, layer);
  }

  return segments;
}

export function linesForStation(network, stationId) {
  return network.lines.filter((line) => line.path.includes(stationId));
}

export function networkBounds(network, padding = 60) {
  const pts = Object.values(network.stations);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return {
    x: minX,
    y: minY,
    w: Math.max(...xs) + padding * 2.5 - minX,
    h: Math.max(...ys) + padding - minY,
  };
}

/**
 * Draws the network into the SVG element.
 * photoCounts: { stationId: number }
 * onSelect(stationId) is called when a station is clicked or activated with the keyboard.
 */
export function renderMap(svg, network, photoCounts, onSelect) {
  const { lines, stations } = network;
  const shared = collectSharedSegments(lines, stations);

  svg.replaceChildren();
  const contextLayer = el("g", { class: "context", "aria-hidden": "true" }, svg);
  const contextSegments = renderContext(contextLayer, network.context, stations);
  const linesLayer = el("g", { class: "lines" }, svg);
  const stationsLayer = el("g", { class: "stations" }, svg);

  // Where each line passes each station (after offsets), used to size station markers.
  const passes = {};
  const drawn = {};

  for (const line of lines) {
    const { points, atNode } = offsetLine(line, stations, shared);
    drawn[line.id] = points;
    el(
      "polyline",
      {
        points: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
        stroke: line.color,
        "stroke-width": LINE_WIDTH,
        class: "route",
        "data-line": line.id,
      },
      linesLayer
    );
    line.path.forEach((entry, i) => {
      if (typeof entry !== "string") return;
      (passes[entry] ||= []).push(atNode[i]);
    });
  }

  const routeSegments = [];
  for (const line of lines) {
    const pts = drawn[line.id];
    for (let i = 0; i < pts.length - 1; i++) routeSegments.push([pts[i], pts[i + 1]]);
  }

  const markers = {};
  const groups = {};
  for (const [id, station] of Object.entries(stations)) {
    const pts = passes[id] || [station];
    // The two passing points that are farthest apart define the marker capsule.
    let a = pts[0];
    let b = pts[0];
    let best = -1;
    for (const p of pts) {
      for (const q of pts) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d > best) {
          best = d;
          a = p;
          b = q;
        }
      }
    }

    const servedBy = linesForStation(network, id).map((l) => l.id);
    const interchange = servedBy.length > 1;
    const count = photoCounts[id] || 0;

    const group = el(
      "g",
      {
        class: `station${count ? " has-photos" : ""}${interchange ? " interchange" : ""}`,
        "data-station": id,
        role: "button",
        tabindex: "0",
        "aria-label": `${station.name} (${servedBy.join(", ")}): ${
          count ? `${count} photo${count > 1 ? "s" : ""}` : "no photos"
        }`,
      },
      stationsLayer
    );

    const coords = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    const r = interchange ? 5 : 3.5;
    el("circle", { class: "hit", cx: station.x, cy: station.y, r: 12 }, group);
    el("line", { ...coords, class: "marker-outline", "stroke-width": r * 2 + 2.5 }, group);
    el("line", { ...coords, class: "marker-fill", "stroke-width": r * 2 }, group);
    markers[id] = { a, b, r: r + 1.25 };
    groups[id] = group;

    group.addEventListener("click", () => onSelect(id));
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(id);
      }
    });
  }

  // Place labels: stations with photos first, then interchanges, then the rest.
  const order = Object.keys(stations).sort(
    (p, q) =>
      Boolean(photoCounts[q]) - Boolean(photoCounts[p]) ||
      linesForStation(network, q).length - linesForStation(network, p).length
  );
  const placed = [];
  for (const id of order) {
    const station = stations[id];
    const group = groups[id];
    const text = el("text", { "font-size": LABEL_SIZE, class: "label" }, group);
    // Measure with the final CSS (bold for stations with photos).
    const widthOf = (str) => {
      text.textContent = str;
      return text.getComputedTextLength();
    };

    let best = null;
    for (const c of labelCandidates(station.name, markers[id], widthOf, station.label)) {
      let cost = c.base;
      const padded = inflate(c.rect, 1);
      for (const rect of placed) if (rectsOverlap(padded, rect)) cost += COST.label;
      for (const [otherId, m] of Object.entries(markers)) {
        if (otherId !== id && segmentHitsRect(m.a, m.b, inflate(c.rect, m.r))) cost += COST.marker;
      }
      // A label that is nearer to another station than to its own is easy to misread.
      const own = distanceToRect(station, c.rect);
      for (const [otherId, other] of Object.entries(stations)) {
        if (otherId !== id && distanceToRect(other, c.rect) < own) {
          cost += COST.ambiguous;
          break;
        }
      }
      for (const [p, q] of routeSegments) {
        if (segmentHitsRect(p, q, inflate(c.rect, LINE_WIDTH / 2))) cost += COST.line;
      }
      for (const [p, q] of contextSegments) {
        if (segmentHitsRect(p, q, inflate(c.rect, 2))) cost += COST.context;
      }
      if (!best || cost < best.cost) best = { ...c, cost };
      if (cost === 0) break;
    }

    placed.push(best.rect);
    text.textContent = "";
    text.setAttribute("text-anchor", best.anchor);
    best.lines.forEach((str, i) => {
      const tspan = el("tspan", { x: best.x.toFixed(1), y: (best.y + i * LINE_HEIGHT).toFixed(1) }, text);
      tspan.textContent = str;
    });
  }
}
