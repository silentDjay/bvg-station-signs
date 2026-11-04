import { renderMap, linesForStation, networkBounds } from "./map.js";
import { createPanZoom } from "./panzoom.js";
import { openModal, closeModal, isModalOpen, onModalClose } from "./modal.js";

const svg = document.getElementById("map");
const statusEl = document.getElementById("coverage");

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function init() {
  const [network, photos] = await Promise.all([
    loadJson("data/network.json"),
    // photos.json does not exist until the first photo import.
    loadJson("data/photos.json").catch(() => ({})),
  ]);

  const photoCounts = Object.fromEntries(Object.entries(photos).map(([id, list]) => [id, list.length]));

  function selectStation(id, { updateHash = true } = {}) {
    const station = network.stations[id];
    if (!station) return;
    openModal(station, linesForStation(network, id), photos[id] || []);
    if (updateHash && location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
  }

  renderMap(svg, network, photoCounts, (id) => selectStation(id));
  const home = networkBounds(network);
  const panZoom = createPanZoom(svg, home);

  // On tall, narrow screens (phones), start zoomed in so the map fills the height.
  const rect = svg.getBoundingClientRect();
  const fill = home.w / home.h / (rect.width / rect.height);
  if (fill > 1.3) panZoom.focus(home.x + home.w / 2, home.y + home.h / 2, Math.min(fill, 3));

  onModalClose(() => {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  });

  document.getElementById("zoomIn").addEventListener("click", panZoom.zoomIn);
  document.getElementById("zoomOut").addEventListener("click", panZoom.zoomOut);
  document.getElementById("zoomReset").addEventListener("click", panZoom.reset);

  const total = Object.keys(network.stations).length;
  const covered = Object.keys(network.stations).filter((id) => photoCounts[id]).length;
  statusEl.textContent = `${covered} of ${total} stations photographed`;

  // Show or hide the Ringbahn and water. Remember the choice in this browser.
  const contextToggle = document.getElementById("contextToggle");
  const applyContext = () => svg.classList.toggle("hide-context", !contextToggle.checked);
  contextToggle.checked = localStorage.getItem("showContext") !== "false";
  applyContext();
  contextToggle.addEventListener("change", () => {
    localStorage.setItem("showContext", contextToggle.checked);
    applyContext();
  });

  // Open the station in the URL hash, for example index.html#alexanderplatz.
  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (network.stations[id]) {
      const { x, y } = network.stations[id];
      panZoom.focus(x, y);
      selectStation(id, { updateHash: false });
    } else if (isModalOpen()) {
      closeModal();
    }
  }
  window.addEventListener("hashchange", openFromHash);
  openFromHash();
}

init().catch((error) => {
  console.error(error);
  statusEl.textContent = "Could not load the map data.";
});
