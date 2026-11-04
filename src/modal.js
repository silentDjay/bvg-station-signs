const SWIPE_THRESHOLD = 40; // px

const modal = document.getElementById("modal");
const closeBtn = modal.querySelector(".close-btn");
const stationNameEl = document.getElementById("stationName");
const stationLinesEl = document.getElementById("stationLines");
const carousel = document.getElementById("carousel");
const carouselContainer = carousel.querySelector(".carousel-container");
const noPhotos = document.getElementById("noPhotos");
const carouselImage = document.getElementById("carouselImage");
const currentPhotoSpan = document.getElementById("currentPhoto");
const totalPhotosSpan = document.getElementById("totalPhotos");
const photoDate = document.getElementById("photoDate");
const prevBtn = carousel.querySelector(".carousel-btn.prev");
const nextBtn = carousel.querySelector(".carousel-btn.next");

let currentCarouselIndex = 0;
let currentStationPhotos = [];
let currentStationName = "";
let returnFocusTo = null;
let onCloseCallback = () => {};

// All photos are from Berlin, so show the time as Berlin local time.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

function srcsetOf(photo) {
  return `${photo.thumb} ${photo.thumbWidth}w, ${photo.src} ${photo.width}w`;
}

function preload(photo) {
  const img = new Image();
  img.sizes = carouselImage.sizes;
  img.srcset = srcsetOf(photo);
}

function showPhoto(index) {
  if (currentStationPhotos.length === 0) return;

  const total = currentStationPhotos.length;
  currentCarouselIndex = (index + total) % total;
  const photo = currentStationPhotos[currentCarouselIndex];

  carouselImage.width = photo.width;
  carouselImage.height = photo.height;
  carouselImage.srcset = srcsetOf(photo);
  carouselImage.src = photo.src;
  carouselImage.alt = `Station sign at ${currentStationName}, photo ${currentCarouselIndex + 1} of ${total}`;
  if (photo.takenAt) {
    photoDate.dateTime = photo.takenAt;
    photoDate.textContent = `Taken ${dateFormat.format(new Date(photo.takenAt))}`;
  } else {
    photoDate.removeAttribute("datetime");
    photoDate.textContent = "";
  }
  currentPhotoSpan.textContent = currentCarouselIndex + 1;
  totalPhotosSpan.textContent = total;

  const single = total === 1;
  prevBtn.hidden = single;
  nextBtn.hidden = single;
  carousel.querySelector(".carousel-counter").hidden = single;

  if (!single) preload(currentStationPhotos[(currentCarouselIndex + 1) % total]);
}

export function isModalOpen() {
  return !modal.classList.contains("hidden");
}

/** lines: [{ id, color }]; photos: [{ src, thumb, width, height, thumbWidth, takenAt? }] */
export function openModal(station, lines, photos) {
  if (!isModalOpen()) returnFocusTo = document.activeElement;

  currentStationName = station.name;
  stationNameEl.textContent = station.name;
  stationLinesEl.replaceChildren(
    ...lines.map((line) => {
      const badge = document.createElement("span");
      badge.className = "line";
      badge.style.backgroundColor = line.color;
      badge.textContent = line.id;
      return badge;
    })
  );

  currentStationPhotos = photos;
  currentCarouselIndex = 0;

  if (photos.length > 0) {
    carousel.classList.remove("hidden");
    noPhotos.classList.add("hidden");
    showPhoto(0);
  } else {
    carousel.classList.add("hidden");
    noPhotos.classList.remove("hidden");
    carouselImage.removeAttribute("src");
    carouselImage.removeAttribute("srcset");
  }

  modal.classList.remove("hidden");
  closeBtn.focus();
}

export function closeModal() {
  if (!isModalOpen()) return;
  modal.classList.add("hidden");
  returnFocusTo?.focus?.({ preventScroll: true });
  onCloseCallback();
}

export function onModalClose(callback) {
  onCloseCallback = callback;
}

// Event listeners
closeBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

prevBtn.addEventListener("click", () => showPhoto(currentCarouselIndex - 1));
nextBtn.addEventListener("click", () => showPhoto(currentCarouselIndex + 1));

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  if (!isModalOpen()) return;

  if (e.key === "ArrowLeft") showPhoto(currentCarouselIndex - 1);
  if (e.key === "ArrowRight") showPhoto(currentCarouselIndex + 1);
  if (e.key === "Escape") closeModal();
});

// Swipe navigation on touch screens
let swipeStart = null;
carouselContainer.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse") swipeStart = { x: e.clientX, y: e.clientY };
});
carouselContainer.addEventListener("pointerup", (e) => {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
    showPhoto(currentCarouselIndex + (dx < 0 ? 1 : -1));
  }
});
carouselContainer.addEventListener("pointercancel", () => {
  swipeStart = null;
});
