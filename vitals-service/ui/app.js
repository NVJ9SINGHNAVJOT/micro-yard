"use strict";

/**
 * Vitals — Dashboard Application
 *
 * Architecture:
 *   Config     → constants & palettes
 *   API        → thin HTTP layer
 *   State      → single mutable timeline/poll state
 *   DOM        → cached element references
 *   Charts     → TimelineChart singletons (see charts.js)
 *   Formatters → pure time/display helpers
 *   Gauges     → live system + service gauge rendering
 *   Poll       → live snapshot loop (/stats)
 *   Timeline   → historical/live range charts (/history)
 *   SvcFilter  → per-service show/hide toggles
 *   Controls   → live toggle, presets, range inputs
 *   Init       → boot sequence
 */

// ─── Config ──────────────────────────────────────────────────────────────────

// Poll the agent and render the dashboard. The agent collects on a fixed 2s
// cadence, so polling faster gains nothing — match it.
const POLL_MS = 2000;

const MAX_POINTS = 600; // downsample cap sent to the agent

// System metric colors, shared with the timeline's system chart.
const SYS_COLORS = {
  cpu: "#58a6ff",
  mem: "#3fb950",
  gpu: "#bc8cff",
};

// Per-service palette. Deliberately avoids the system chart's blue/green/purple
// (CPU/RAM/GPU) so a service is never confused with a system metric. Each
// service gets ONE color, reused for both its CPU and its RAM line.
const SVC_COLORS = [
  "#f0883e", // orange
  "#39c5cf", // cyan
  "#db61a2", // pink
  "#e3b341", // gold
  "#f85149", // red
  "#9e6a3f", // brown
  "#ff9bce", // light pink
];

// ─── API ─────────────────────────────────────────────────────────────────────

const API = {
  /** GET a path and parse JSON, throwing on any non-2xx response. */
  async fetchJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return res.json();
  },

  /** Fetch the latest live snapshot. */
  stats() {
    return this.fetchJSON("/stats");
  },

  /** Fetch a downsampled sample window [from,to] (unix seconds). */
  history(from, to) {
    return this.fetchJSON(`/history?from=${from}&to=${to}&points=${MAX_POINTS}`);
  },
};

// ─── State ───────────────────────────────────────────────────────────────────

// Timeline: system + services usage over a time range, live or historical.
// Live and range mode share one /history?from=&to=&points= request; the agent
// flushes every sample, so "live" is just a range that ends at now and refreshes.
const state = {
  live: true,
  windowSec: 300, // lookback used in live mode
  timer: null,
  svcNames: [], // stable, growing order → drives per-service color
  svcHidden: new Set(), // services the user toggled off in the filter
};

// ─── DOM ─────────────────────────────────────────────────────────────────────

/** @param {string} id */
const $ = (id) => document.getElementById(id);

/** @param {string} sel */
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  status: $("status"),
  statusText: $("statusText"),
  updated: $("updated"),
  services: $("services"),
  liveBtn: $("liveBtn"),
  liveLabel: $("liveLabel"),
  fromInput: $("fromInput"),
  toInput: $("toInput"),
  svcFilter: $("svcFilter"),
  gauges: {}, // metric → <canvas>, filled below
};

$$(".gauge").forEach((c) => (dom.gauges[c.dataset.metric] = c));

// ─── Charts ──────────────────────────────────────────────────────────────────

const charts = {
  sys: new TimelineChart($("sysChart"), $("sysTip"), { yMax: 100, unit: "%" }),
  svcCpu: new TimelineChart($("svcCpuChart"), $("svcCpuTip"), { yMax: null, unit: "%" }),
  svcRam: new TimelineChart($("svcRamChart"), $("svcRamTip"), { yMax: null, unit: "MB" }),
};

// ─── Formatters ──────────────────────────────────────────────────────────────

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// datetime-local <-> unix seconds, in the browser's local zone.
function toInputValue(sec) {
  const d = new Date(sec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputValue(v) {
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** One label/value line inside a service card. */
function metricRow(label, value) {
  return `<div class="metric-row"><span>${label}</span><span class="val">${value}</span></div>`;
}

// svcColor keeps a service's color stable regardless of who's visible.
function svcColor(name) {
  const i = state.svcNames.indexOf(name);
  return SVC_COLORS[(i < 0 ? 0 : i) % SVC_COLORS.length];
}

// ─── Gauges ──────────────────────────────────────────────────────────────────

const Gauges = {
  /** Draw the three system gauges (CPU / RAM / GPU) for a snapshot. */
  renderSystem(snap) {
    const s = snap.system;
    drawGauge(dom.gauges.cpu, s.cpu_total_percent, SYS_COLORS.cpu, Math.round(s.cpu_total_percent) + "%");
    drawGauge(dom.gauges.mem, s.mem_percent, SYS_COLORS.mem, Math.round(s.mem_percent) + "%");

    if (snap.gpu && snap.gpu.available) {
      drawGauge(dom.gauges.gpu, snap.gpu.gpu_util_percent, SYS_COLORS.gpu, Math.round(snap.gpu.gpu_util_percent) + "%");
    } else {
      drawGauge(dom.gauges.gpu, null, SYS_COLORS.gpu, "n/a");
    }
  },

  /** Render one card per service with its live CPU / RAM (or a down state). */
  renderServices(snap) {
    const names = Object.keys(snap.services);
    if (!names.length) {
      dom.services.innerHTML = `<div class="empty-note">No services configured.</div>`;
      return;
    }
    dom.services.innerHTML = names
      .map((name) => {
        const svc = snap.services[name];
        if (!svc.running) {
          return `<div class="service-card down">
            <div class="service-head"><span class="service-name">${name}</span>
            <span class="badge down">not running</span></div>
            ${metricRow("CPU", "—")}${metricRow("RAM", "—")}</div>`;
        }
        return `<div class="service-card">
          <div class="service-head"><span class="service-name">${name}</span>
          <span class="badge up">pid ${svc.pid}</span></div>
          ${metricRow("CPU", svc.cpu_percent.toFixed(1) + "%")}
          ${metricRow("RAM", svc.rss_mb.toFixed(1) + " MB")}</div>`;
      })
      .join("");
  },
};

// ─── Poll ────────────────────────────────────────────────────────────────────

const Poll = {
  /** Fetch a live snapshot and refresh gauges + service cards. */
  async tick() {
    try {
      const snap = await API.stats();
      dom.statusText.textContent = "Live";
      dom.status.className = "status ok";
      dom.updated.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      Gauges.renderSystem(snap);
      Gauges.renderServices(snap);
    } catch (err) {
      dom.statusText.textContent = "Disconnected";
      dom.status.className = "status err";
    }
  },
};

// ─── Timeline ────────────────────────────────────────────────────────────────

const Timeline = {
  /** Resolve the active window as { from, to } (unix seconds). */
  currentRange() {
    if (state.live) {
      const to = nowSec();
      return { from: to - state.windowSec, to };
    }
    const from = fromInputValue(dom.fromInput.value);
    const to = fromInputValue(dom.toInput.value);
    return { from: from ?? nowSec() - 3600, to: to ?? nowSec() };
  },

  /** Fetch the window's samples and repaint all three timeline charts. */
  async load() {
    const { from, to } = this.currentRange();
    if (state.live) {
      // reflect the moving window in the (disabled) inputs
      dom.fromInput.value = toInputValue(from);
      dom.toInput.value = toInputValue(to);
    }
    let data;
    try {
      data = await API.history(from, to);
    } catch (err) {
      return; // status line already covers agent reachability
    }
    const samples = data.samples || [];

    // System: three percentage series over the window.
    charts.sys.setData(from, to, [
      { label: "CPU", color: SYS_COLORS.cpu, points: samples.map((s) => ({ ts: s.ts, value: s.system.cpu_total_percent })) },
      { label: "RAM", color: SYS_COLORS.mem, points: samples.map((s) => ({ ts: s.ts, value: s.system.mem_percent })) },
      {
        label: "GPU",
        color: SYS_COLORS.gpu,
        points: samples.filter((s) => s.gpu && s.gpu.available).map((s) => ({ ts: s.ts, value: s.gpu.gpu_util_percent })),
      },
    ]);

    // Track any newly-seen service names (stable order) and refresh the filter.
    let namesChanged = false;
    samples.forEach((s) =>
      Object.keys(s.services || {}).forEach((n) => {
        if (!state.svcNames.includes(n)) {
          state.svcNames.push(n);
          namesChanged = true;
        }
      })
    );
    if (namesChanged) SvcFilter.render();

    // Services: one line per *visible* service, for CPU% and RAM(MB) in parallel.
    // A sample where the service isn't running contributes no point at all —
    // emitting 0 would draw a flat zero line, which reads as "running, idle"
    // rather than "not running". Leaving the hole lets the chart break the line.
    const visible = state.svcNames.filter((n) => !state.svcHidden.has(n));
    const buildSeries = (isCpu) =>
      visible.map((name) => ({
        label: name,
        color: svcColor(name),
        points: samples.reduce((pts, s) => {
          const svc = s.services && s.services[name];
          if (svc && svc.running) pts.push({ ts: s.ts, value: (isCpu ? svc.cpu_percent : svc.rss_mb) || 0 });
          return pts;
        }, []),
      }));
    charts.svcCpu.setData(from, to, buildSeries(true));
    charts.svcRam.setData(from, to, buildSeries(false));
  },
};

// ─── Service Filter ──────────────────────────────────────────────────────────

const SvcFilter = {
  // render draws a toggle button per known service; clicking hides/shows it in
  // both service charts. The delegated click handler is wired once, below.
  render() {
    dom.svcFilter.innerHTML = state.svcNames
      .map(
        (n) =>
          `<button class="svc-tog ${state.svcHidden.has(n) ? "" : "on"}" data-name="${n}">` +
          `<i style="--c:${svcColor(n)}"></i>${n}</button>`
      )
      .join("");
  },
};

dom.svcFilter.addEventListener("click", (e) => {
  const btn = e.target.closest(".svc-tog");
  if (!btn) return;
  const name = btn.dataset.name;
  if (state.svcHidden.has(name)) state.svcHidden.delete(name);
  else state.svcHidden.add(name);
  btn.classList.toggle("on");
  Timeline.load();
});

// ─── Controls ────────────────────────────────────────────────────────────────

/** Toggle live-follow mode on/off, (re)starting or clearing the refresh timer. */
function setLive(on) {
  state.live = on;
  dom.liveBtn.classList.toggle("on", on);
  dom.liveLabel.textContent = on ? "Live" : "Paused";
  dom.fromInput.disabled = on;
  dom.toInput.disabled = on;
  if (state.timer) clearInterval(state.timer);
  if (on) {
    Timeline.load();
    state.timer = setInterval(() => Timeline.load(), POLL_MS);
  } else {
    state.timer = null;
  }
}

dom.liveBtn.addEventListener("click", () => setLive(!state.live));

// highlightPreset marks the active range button (or clears all for a custom
// range, pass null) so the selected window reads at a glance.
function highlightPreset(range) {
  $$(".presets button").forEach((b) => b.classList.toggle("active", b.dataset.range === range));
}

$$(".presets button").forEach((b) => {
  b.addEventListener("click", () => {
    const r = b.dataset.range;
    highlightPreset(r);
    if (r === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      setLive(false);
      dom.fromInput.value = toInputValue(Math.floor(d.getTime() / 1000));
      dom.toInput.value = toInputValue(nowSec());
      Timeline.load();
    } else {
      state.windowSec = parseInt(r, 10);
      if (state.live) {
        Timeline.load(); // keep following, just widen/narrow the window
      } else {
        setLive(false);
        dom.toInput.value = toInputValue(nowSec());
        dom.fromInput.value = toInputValue(nowSec() - state.windowSec);
        Timeline.load();
      }
    }
  });
});

[dom.fromInput, dom.toInput].forEach((el) =>
  el.addEventListener("change", () => {
    if (state.live) setLive(false);
    highlightPreset(null); // hand-edited range no longer matches a preset
    Timeline.load();
  })
);

window.addEventListener("resize", () => {
  charts.sys.render();
  charts.svcCpu.render();
  charts.svcRam.render();
});

// ─── Init ────────────────────────────────────────────────────────────────────

Poll.tick();
setInterval(() => Poll.tick(), POLL_MS);
highlightPreset(String(state.windowSec)); // reflect the default lookback (5m)
setLive(true); // start the timeline in live mode
