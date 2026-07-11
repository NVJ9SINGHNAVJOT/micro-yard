"use strict";

/**
 * Storage Vault — Dashboard Application
 *
 * Architecture:
 *   Config     → constants & lookup tables
 *   API        → thin HTTP layer
 *   State      → single mutable state object
 *   DOM        → cached element references
 *   Formatters → pure display helpers
 *   Toast      → notification system
 *   Cards      → file card builder
 *   Grid       → render orchestration + infinite scroll
 *   Lightbox   → media preview modal
 *   Delete     → single & bulk delete flows
 *   Nav        → category navigation
 *   Sort       → sort dropdown
 *   ViewMode   → compact / default / large toggle
 *   Init       → boot sequence
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const SCROLL_THRESHOLD_PX = 200;
const TOAST_DURATION_MS = 3000;
const TOAST_FADE_MS = 250;
const LS_KEY_VIEW = "viewMode";

const CATEGORY_META = {
  "": {
    title: "All Files",
    subtitle: "Manage your entire vault",
    icon: "folder",
  },
  images: {
    title: "Images",
    subtitle: "Manage your high-resolution memories",
    icon: "image",
  },
  videos: {
    title: "Videos",
    subtitle: "Manage your video collection",
    icon: "movie",
  },
  audio: {
    title: "Audio",
    subtitle: "Manage your audio files",
    icon: "audiotrack",
  },
  documents: {
    title: "Documents",
    subtitle: "Manage your important documents",
    icon: "description",
  },
  others: {
    title: "Others",
    subtitle: "Manage other file types",
    icon: "folder_open",
  },
};

const CATEGORY_ICON = Object.fromEntries(
  Object.entries(CATEGORY_META).map(([k, v]) => [k, v.icon]),
);

const ICON_PATHS = {
  folder:
    '<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>',
  image:
    '<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>',
  movie:
    '<path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>',
  audiotrack:
    '<path d="M12 3v9.28a4.39 4.39 0 0 0-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>',
  description:
    '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
  folder_open:
    '<path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>',
  visibility:
    '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>',
  download: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
  delete:
    '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  check_circle:
    '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
  error:
    '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>',
  inbox:
    '<path d="M19 3H4.99c-1.11 0-1.98.89-1.98 2L3 19c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z"/>',
};

function icon(name, size = 20) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" width="${size}" height="${size}" aria-hidden="true">${ICON_PATHS[name] ?? ""}</svg>`;
}

// ─── API ─────────────────────────────────────────────────────────────────────

const API = {
  /**
   * Fetch a paginated, filtered, sorted list of media.
   * @returns {Promise<{data: object[], pagination: object}>}
   */
  list(
    category = "",
    sortBy = "created_at",
    order = "desc",
    limit = PAGE_SIZE,
    offset = 0,
  ) {
    const params = new URLSearchParams({
      category,
      sort_by: sortBy,
      order,
      limit,
      offset,
    });
    return fetch(`/api/media?${params}`).then((r) => r.json());
  },

  /** Delete a media item by ID. */
  delete(id) {
    return fetch(`/api/media/${id}`, { method: "DELETE" });
  },

  /** Build the raw-file URL for a given media ID. */
  fileUrl(id) {
    return `/api/media/${id}/file`;
  },
};

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  media: [],
  category: "",
  sortBy: "created_at",
  order: "desc",

  // Pagination
  limit: PAGE_SIZE,
  offset: 0,
  hasMore: false,
  isLoading: false,
  totalCount: 0,

  // Delete flow
  itemToDelete: null,

  // View mode (persisted)
  viewMode: localStorage.getItem(LS_KEY_VIEW) || "default",
};

// ─── DOM ─────────────────────────────────────────────────────────────────────

/** @param {string} id */
const $ = (id) => document.getElementById(id);

/** @param {string} sel */
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  grid: $("grid"),
  pageTitle: $("page-title"),
  pageSubtitle: $("page-subtitle"),
  btnSort: $("btn-sort"),
  sortMenu: $("sort-menu"),
  sortLabel: $("sort-label"),
  btnDeleteAll: $("btn-delete-all"),
  scrollLoader: $("scroll-loader"),
  viewSwitcher: $("view-switcher"),
  toastContainer: $("toast-container"),
  storageMeter: $("storage-detail"),
  deleteModal: $("delete-modal"),
  deleteText: $("delete-modal-text"),
  confirmBtn: $("confirm-delete-btn"),
  lightboxModal: $("lightbox-modal"),
  lightboxMedia: $("lightbox-media-container"),
};

// ─── Formatters ──────────────────────────────────────────────────────────────

const BYTE_UNITS = ["Bytes", "KB", "MB", "GB", "TB"];

/** Format a byte count to a human-readable string. */
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = Math.max(0, decimals);
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${BYTE_UNITS[i]}`;
}

/** Format an ISO-8601 timestamp to a short date. */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Toast ───────────────────────────────────────────────────────────────────

/** @param {"success"|"error"} type */
function showToast(message, type = "success") {
  const iconName = type === "success" ? "check_circle" : "error";
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `${icon(iconName)} ${message}`;
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, TOAST_DURATION_MS);
}

// ─── Cards ───────────────────────────────────────────────────────────────────

/** Create an overlay action button (view, download). */
function createOverlayBtn(iconName, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn-overlay";
  btn.innerHTML = icon(iconName);
  btn.addEventListener("click", onClick);
  return btn;
}

/** Build a complete file-card DOM element for a media object. */
function createCard(file) {
  const card = document.createElement("div");
  card.className = "file-card glass glow-border";

  // ── Preview ──
  const preview = document.createElement("div");
  preview.className = "file-card__preview";

  if (file.category === "images") {
    const img = document.createElement("img");
    img.src = API.fileUrl(file.id);
    img.loading = "lazy";
    preview.appendChild(img);
  } else {
    const iconWrap = document.createElement("div");
    iconWrap.className = "file-card__preview-icon";
    iconWrap.innerHTML = `
      ${icon(CATEGORY_ICON[file.category] || "folder_open")}
      <span>${file.category}</span>`;
    preview.appendChild(iconWrap);
  }

  // ── Hover overlay ──
  const overlay = document.createElement("div");
  overlay.className = "file-card__overlay";

  if (
    file.category === "images" ||
    file.category === "videos" ||
    file.category === "audio"
  ) {
    overlay.appendChild(
      createOverlayBtn("visibility", () => Lightbox.open(file)),
    );
  }
  overlay.appendChild(createOverlayBtn("download", () => downloadFile(file)));
  preview.appendChild(overlay);

  // ── Info ──
  const info = document.createElement("div");
  info.className = "file-card__info";

  const name = document.createElement("div");
  name.className = "file-card__name";
  name.textContent = file.originalFilename;

  const metaRow = document.createElement("div");
  metaRow.className = "file-card__meta-row";

  const meta = document.createElement("span");
  meta.className = "file-card__meta";
  meta.textContent = `${formatBytes(file.size)} · ${formatDate(file.createdAt)}`;

  const delBtn = document.createElement("button");
  delBtn.className = "btn-delete-icon";
  delBtn.innerHTML = icon("delete");
  delBtn.addEventListener("click", () => DeleteFlow.confirmSingle(file));

  metaRow.append(meta, delBtn);
  info.append(name, metaRow);
  card.append(preview, info);

  // ── Inline audio player ──
  if (file.category === "audio") {
    const audio = document.createElement("audio");
    audio.className = "file-card__audio";
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = API.fileUrl(file.id);
    card.appendChild(audio);
  }

  return card;
}

// ─── Grid ────────────────────────────────────────────────────────────────────

const Grid = {
  /** Full reload: reset pagination, fetch first page, re-render. */
  async load() {
    state.offset = 0;
    state.media = [];
    state.hasMore = false;
    state.isLoading = true;
    dom.grid.innerHTML =
      '<div class="loading"><div class="spinner"></div></div>';
    dom.scrollLoader.style.display = "none";

    try {
      const { data = [], pagination = {} } = await API.list(
        state.category,
        state.sortBy,
        state.order,
        state.limit,
        0,
      );
      state.media = data;
      state.hasMore = pagination.hasMore ?? false;
      state.totalCount = pagination.total ?? 0;
      state.offset = data.length;
      this.render();
      StorageMeter.update();
    } catch (err) {
      console.error("Grid.load failed:", err);
      showToast("Failed to load media", "error");
      dom.grid.innerHTML = "";
    } finally {
      state.isLoading = false;
    }
  },

  /** Fetch and append the next page of results. */
  async loadMore() {
    if (state.isLoading || !state.hasMore) return;
    state.isLoading = true;
    dom.scrollLoader.style.display = "flex";

    try {
      const { data = [], pagination = {} } = await API.list(
        state.category,
        state.sortBy,
        state.order,
        state.limit,
        state.offset,
      );
      state.hasMore = pagination.hasMore ?? false;
      state.media.push(...data);
      state.offset += data.length;

      // Batch-append using DocumentFragment for fewer reflows
      const fragment = document.createDocumentFragment();
      data.forEach((file) => fragment.appendChild(createCard(file)));
      dom.grid.appendChild(fragment);

      StorageMeter.update();
    } catch (err) {
      console.error("Grid.loadMore failed:", err);
      showToast("Failed to load more media", "error");
    } finally {
      state.isLoading = false;
      dom.scrollLoader.style.display = "none";
    }
  },

  /** Clear and re-render the grid from state.media. */
  render() {
    dom.grid.innerHTML = "";

    if (state.media.length === 0) {
      dom.grid.innerHTML = `
        <div class="empty-state">
          ${icon("inbox", 64)}
          <h3 class="empty-state__title">Vault is Empty</h3>
          <p class="empty-state__desc">No files found in this category.</p>
        </div>`;
      dom.btnDeleteAll.style.display = "none";
      return;
    }

    dom.btnDeleteAll.style.display = state.category ? "inline-flex" : "none";

    const fragment = document.createDocumentFragment();
    state.media.forEach((file) => fragment.appendChild(createCard(file)));
    dom.grid.appendChild(fragment);
  },
};

// ─── Infinite Scroll ─────────────────────────────────────────────────────────

/** Debounce utility: collapse rapid calls into one trailing invocation. */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const handleScroll = debounce(() => {
  const { scrollY, innerHeight } = window;
  const docHeight = document.documentElement.scrollHeight;
  if (docHeight - (scrollY + innerHeight) < SCROLL_THRESHOLD_PX) {
    Grid.loadMore();
  }
}, 100);

window.addEventListener("scroll", handleScroll, { passive: true });

// ─── Lightbox ────────────────────────────────────────────────────────────────

const Lightbox = {
  /** Open the lightbox for an image, video, or audio file. */
  open(file) {
    dom.lightboxMedia.innerHTML = "";

    if (file.category === "images") {
      const img = document.createElement("img");
      img.src = API.fileUrl(file.id);
      dom.lightboxMedia.appendChild(img);
    } else if (file.category === "videos") {
      const vid = document.createElement("video");
      vid.src = API.fileUrl(file.id);
      vid.controls = true;
      vid.autoplay = true;
      dom.lightboxMedia.appendChild(vid);
    } else if (file.category === "audio") {
      const audio = document.createElement("audio");
      audio.src = API.fileUrl(file.id);
      audio.controls = true;
      audio.autoplay = true;
      dom.lightboxMedia.appendChild(audio);
    }

    dom.lightboxModal.classList.add("open");
  },

  close() {
    dom.lightboxModal.classList.remove("open");
    dom.lightboxMedia.innerHTML = "";
  },
};

// ─── Delete ──────────────────────────────────────────────────────────────────

const DeleteFlow = {
  confirmSingle(file) {
    state.itemToDelete = file;
    dom.deleteText.textContent = `Are you sure you want to delete "${file.originalFilename}"? This action cannot be undone.`;
    dom.deleteModal.classList.add("open");
  },

  confirmAll() {
    if (state.media.length === 0) return;
    state.itemToDelete = "all";
    const { title } = CATEGORY_META[state.category] || {};
    dom.deleteText.textContent = `Are you sure you want to delete all ${state.media.length} items in ${title}? This action cannot be undone.`;
    dom.deleteModal.classList.add("open");
  },

  async execute() {
    const btn = dom.confirmBtn;
    btn.disabled = true;
    btn.textContent = "Deleting…";

    try {
      if (state.itemToDelete === "all") {
        await Promise.all(state.media.map((f) => API.delete(f.id)));
        showToast("Deleted all items");
      } else {
        await API.delete(state.itemToDelete.id);
        showToast("File deleted");
      }
      closeModal("delete-modal");
      Grid.load();
    } catch {
      showToast("Delete failed", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Delete";
    }
  },
};

dom.btnDeleteAll.addEventListener("click", () => DeleteFlow.confirmAll());
dom.confirmBtn.addEventListener("click", () => DeleteFlow.execute());

// ─── Modal Helpers ───────────────────────────────────────────────────────────

/** Close any modal by ID. Exposed globally for inline onclick handlers. */
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  if (id === "lightbox-modal") {
    dom.lightboxMedia.innerHTML = "";
  }
}

// ─── File Download ───────────────────────────────────────────────────────────

function downloadFile(file) {
  const a = document.createElement("a");
  a.href = API.fileUrl(file.id);
  a.download = file.originalFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ─── Navigation ──────────────────────────────────────────────────────────────

$$(".nav-link, .mobile-nav__item").forEach((link) => {
  link.addEventListener("click", () => {
    const cat = link.dataset.category;

    // Sync active state across desktop + mobile nav
    $$(".nav-link, .mobile-nav__item").forEach((l) =>
      l.classList.remove("active"),
    );
    $$(`[data-category="${cat}"]`).forEach((l) => l.classList.add("active"));

    state.category = cat;
    const meta = CATEGORY_META[cat];
    dom.pageTitle.textContent = meta.title;
    dom.pageSubtitle.textContent = meta.subtitle;

    Grid.load();
  });
});

// ─── Sort ────────────────────────────────────────────────────────────────────

dom.btnSort.addEventListener("click", (e) => {
  e.stopPropagation();
  dom.sortMenu.classList.toggle("open");
});

document.addEventListener("click", () => dom.sortMenu.classList.remove("open"));

$$(".sort-dropdown__item").forEach((item) => {
  item.addEventListener("click", () => {
    $$(".sort-dropdown__item").forEach((i) => i.classList.remove("active"));
    item.classList.add("active");
    dom.sortLabel.textContent = item.textContent;
    state.sortBy = item.dataset.sort;
    state.order = item.dataset.order;
    Grid.load();
  });
});

// ─── View Mode ───────────────────────────────────────────────────────────────

const ViewMode = {
  apply(mode) {
    state.viewMode = mode;
    dom.grid.setAttribute("data-view", mode);
    localStorage.setItem(LS_KEY_VIEW, mode);
    $$(".view-switcher__btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === mode);
    });
  },
};

// Event delegation: single listener on the container
dom.viewSwitcher.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-switcher__btn");
  if (btn) ViewMode.apply(btn.dataset.view);
});

// ─── Storage Meter ───────────────────────────────────────────────────────────

const StorageMeter = {
  update() {
    const total = state.media.reduce((sum, f) => sum + f.size, 0);
    dom.storageMeter.textContent = formatBytes(total);
  },
};

// ─── Init ────────────────────────────────────────────────────────────────────

ViewMode.apply(state.viewMode);
Grid.load();
