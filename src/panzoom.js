// Pan and zoom an SVG by changing its viewBox. Supports mouse wheel, drag, and pinch.
// Changing the viewBox (not a CSS transform) keeps lines and text sharp at all zoom levels.

const DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag, not a click

export function createPanZoom(svg, home, { minScale = 1, maxScale = 14 } = {}) {
  let view = { ...home };
  const pointers = new Map();
  let gesture = null;
  let suppressClick = false;

  const apply = () => svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);

  // Convert a screen point to SVG user units for the current view.
  function toSvg(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function clamp() {
    const minW = home.w / maxScale;
    const maxW = home.w / minScale;
    if (view.w < minW || view.w > maxW) {
      const w = Math.min(maxW, Math.max(minW, view.w));
      const h = (view.h * w) / view.w;
      view.x += (view.w - w) / 2;
      view.y += (view.h - h) / 2;
      view.w = w;
      view.h = h;
    }
    // Keep the center of the view over the network.
    const cx = Math.min(home.x + home.w, Math.max(home.x, view.x + view.w / 2));
    const cy = Math.min(home.y + home.h, Math.max(home.y, view.y + view.h / 2));
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
  }

  function zoomAt(factor, svgPoint) {
    const w = view.w / factor;
    const h = view.h / factor;
    view.x = svgPoint.x - ((svgPoint.x - view.x) * w) / view.w;
    view.y = svgPoint.y - ((svgPoint.y - view.y) * h) / view.h;
    view.w = w;
    view.h = h;
    clamp();
    apply();
  }

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
      zoomAt(factor, toSvg(e.clientX, e.clientY));
    },
    { passive: false }
  );

  function startGesture() {
    const pts = [...pointers.values()];
    const startView = { ...view };
    if (pts.length === 1) {
      gesture = { type: "pan", start: pts[0], startView, moved: gesture?.moved || false };
    } else if (pts.length >= 2) {
      const [p, q] = pts;
      gesture = {
        type: "pinch",
        startDist: Math.hypot(p.x - q.x, p.y - q.y) || 1,
        startMid: toSvg((p.x + q.x) / 2, (p.y + q.y) / 2),
        startView,
        moved: true,
      };
    }
  }

  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) gesture = null;
    startGesture();
  });

  svg.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];

    if (gesture.type === "pan") {
      const dx = pts[0].x - gesture.start.x;
      const dy = pts[0].y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!gesture.moved) {
        gesture.moved = true;
        svg.setPointerCapture(e.pointerId);
        svg.classList.add("dragging");
      }
      // SVG units per screen pixel. With "meet", one axis is letterboxed, so use the larger ratio.
      const rect = svg.getBoundingClientRect();
      const s = Math.max(gesture.startView.w / rect.width, gesture.startView.h / rect.height);
      view.x = gesture.startView.x - dx * s;
      view.y = gesture.startView.y - dy * s;
      clamp();
      apply();
    } else if (gesture.type === "pinch" && pts.length >= 2) {
      const [p, q] = pts;
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      const factor = dist / gesture.startDist;
      view = { ...gesture.startView };
      apply();
      // Zoom around the starting midpoint, then pan so it follows the fingers.
      zoomAt(factor, gesture.startMid);
      const mid = toSvg((p.x + q.x) / 2, (p.y + q.y) / 2);
      view.x += gesture.startMid.x - mid.x;
      view.y += gesture.startMid.y - mid.y;
      clamp();
      apply();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const moved = gesture?.moved;
    if (pointers.size === 0) {
      suppressClick = Boolean(moved);
      gesture = null;
      svg.classList.remove("dragging");
    } else {
      startGesture();
      if (gesture) gesture.moved = true;
    }
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  // A drag must not also select the station under the pointer.
  svg.addEventListener(
    "click",
    (e) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
        suppressClick = false;
      }
    },
    true
  );

  apply();

  function center() {
    const r = svg.getBoundingClientRect();
    return toSvg(r.left + r.width / 2, r.top + r.height / 2);
  }

  return {
    zoomIn: () => zoomAt(1.5, center()),
    zoomOut: () => zoomAt(1 / 1.5, center()),
    reset: () => {
      view = { ...home };
      apply();
    },
    // Center on a point and zoom in to at least the given scale.
    focus(x, y, scale = 4) {
      const w = Math.min(view.w, home.w / scale);
      const h = (view.h * w) / view.w;
      view = { x: x - w / 2, y: y - h / 2, w, h };
      clamp();
      apply();
    },
  };
}
