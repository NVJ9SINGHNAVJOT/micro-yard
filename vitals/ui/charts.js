"use strict";

/**
 * Vitals — Canvas Chart Primitives
 *
 * Minimal, dependency-free rendering helpers shared by the dashboard (app.js):
 *   Config       → palette
 *   Formatters   → time + geometry helpers
 *   Gauge        → drawGauge() circular gauge
 *   TimelineChart→ multi-series spike chart with hover scrub + tooltip
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const COLORS = {
  cpu: "#58a6ff",
  mem: "#3fb950",
  gpu: "#bc8cff",
  track: "#2a3040",
  text: "#e6edf3",
  muted: "#8b949e",
};

// ─── Formatters ──────────────────────────────────────────────────────────────

// pickColor shades a value red/amber as it approaches 100%.
function pickColor(base, pct) {
  if (pct >= 90) return "#f85149";
  if (pct >= 75) return "#d29922";
  return base;
}

// nearestPoint returns the point whose ts is closest to target (points sorted).
function nearestPoint(points, target) {
  if (!points.length) return null;
  let best = points[0];
  let bestD = Math.abs(points[0].ts - target);
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i].ts - target);
    if (d < bestD) {
      bestD = d;
      best = points[i];
    }
  }
  return best;
}

function fmtClock(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtClockFull(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Gauge ───────────────────────────────────────────────────────────────────

// drawGauge renders a circular gauge showing pct (0..100). label is the big
// centered text (e.g. "23%" or "n/a"). Pass pct=null for an unavailable metric.
function drawGauge(canvas, pct, base, label) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 12;
  ctx.clearRect(0, 0, w, h);

  const start = Math.PI * 0.75;
  const end = Math.PI * 2.25;
  const clamped = Math.max(0, Math.min(100, pct || 0));

  ctx.lineWidth = 12;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.strokeStyle = COLORS.track;
  ctx.arc(cx, cy, r, start, end);
  ctx.stroke();

  if (pct != null) {
    ctx.beginPath();
    ctx.strokeStyle = pickColor(base, clamped);
    ctx.arc(cx, cy, r, start, start + (end - start) * (clamped / 100));
    ctx.stroke();
  }

  ctx.fillStyle = pct == null ? COLORS.muted : COLORS.text;
  ctx.font = "600 24px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy);
}

// ─── TimelineChart ───────────────────────────────────────────────────────────

// TimelineChart draws one or more spike lines over a shared time axis and shows
// a scrub cursor + tooltip on hover, so you can read every series' value at any
// instant. Vanilla canvas, no dependencies — same spirit as drawGauge.
class TimelineChart {
  // canvas: <canvas>. tooltipEl: absolutely-positioned <div> for the readout.
  // opts: { unit: "%"|"MB", yMax: number|null (null = auto-scale) }
  constructor(canvas, tooltipEl, opts = {}) {
    this.canvas = canvas;
    this.tooltip = tooltipEl;
    this.unit = opts.unit || "%";
    this.yMax = opts.yMax ?? null;
    this.pad = { l: 44, r: 12, t: 12, b: 22 };
    this.t0 = 0;
    this.t1 = 0;
    this.series = []; // [{ label, color, points: [{ts, value}] }]
    this.hoverX = null;

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.hoverX = e.clientX - rect.left;
      this.render();
    });
    canvas.addEventListener("mouseleave", () => {
      this.hoverX = null;
      this.tooltip.style.display = "none";
      this.render();
    });
  }

  // setData replaces the window [t0,t1] (unix seconds) and the series list.
  setData(t0, t1, series) {
    this.t0 = t0;
    this.t1 = t1 > t0 ? t1 : t0 + 1;
    this.series = series;
    this.render();
  }

  // fit sizes the backing store to the element for crisp lines on HiDPI.
  fit() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 180;
    if (this.canvas.width !== Math.round(w * dpr)) this.canvas.width = Math.round(w * dpr);
    if (this.canvas.height !== Math.round(h * dpr)) this.canvas.height = Math.round(h * dpr);
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  _yMax() {
    if (this.yMax != null) return this.yMax;
    let m = 0;
    for (const s of this.series)
      for (const p of s.points) if (p.value > m) m = p.value;
    return m <= 0 ? 1 : m * 1.15; // headroom so spikes aren't clipped
  }

  _xOf(ts, area) {
    return area.x + ((ts - this.t0) / (this.t1 - this.t0)) * area.w;
  }
  _yOf(v, area, yMax) {
    return area.y + area.h - (Math.max(0, v) / yMax) * area.h;
  }

  render() {
    const { ctx, w, h } = this.fit();
    const { l, r, t, b } = this.pad;
    const area = { x: l, y: t, w: w - l - r, h: h - t - b };
    ctx.clearRect(0, 0, w, h);

    const yMax = this._yMax();

    // grid + y labels
    ctx.strokeStyle = COLORS.track;
    ctx.fillStyle = COLORS.muted;
    ctx.lineWidth = 1;
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const gy = area.y + (area.h / 4) * i;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(area.x, gy);
      ctx.lineTo(area.x + area.w, gy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const val = yMax * (1 - i / 4);
      // small auto-scaled ranges need a decimal so ticks don't collide (2,1,1,0)
      ctx.fillText(yMax >= 10 ? Math.round(val) + "" : val.toFixed(1), area.x - 6, gy);
    }

    // x time labels (start / mid / end)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const frac of [0, 0.5, 1]) {
      const ts = this.t0 + (this.t1 - this.t0) * frac;
      const x = area.x + area.w * frac;
      ctx.fillText(fmtClock(ts), Math.min(Math.max(x, area.x + 14), area.x + area.w - 14), area.y + area.h + 5);
    }

    if (!this.series.length || !this.series.some((s) => s.points.length)) {
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText("no data in range", area.x + area.w / 2, area.y + area.h / 2);
      return;
    }

    // spike lines with a faint area fill
    for (const s of this.series) {
      if (!s.points.length) continue;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = this._xOf(p.ts, area);
        const y = this._yOf(p.value, area, yMax);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.lineTo(this._xOf(s.points[s.points.length - 1].ts, area), area.y + area.h);
      ctx.lineTo(this._xOf(s.points[0].ts, area), area.y + area.h);
      ctx.closePath();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // hover scrub
    if (this.hoverX != null && this.hoverX >= area.x && this.hoverX <= area.x + area.w) {
      const tsAt = this.t0 + ((this.hoverX - area.x) / area.w) * (this.t1 - this.t0);
      ctx.strokeStyle = COLORS.muted;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(this.hoverX, area.y);
      ctx.lineTo(this.hoverX, area.y + area.h);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const rows = [];
      for (const s of this.series) {
        const p = nearestPoint(s.points, tsAt);
        if (!p) continue;
        const y = this._yOf(p.value, area, yMax);
        ctx.beginPath();
        ctx.fillStyle = s.color;
        ctx.arc(this._xOf(p.ts, area), y, 3, 0, Math.PI * 2);
        ctx.fill();
        rows.push({ color: s.color, label: s.label, value: p.value, ts: p.ts });
      }
      this._showTooltip(rows, tsAt, area, w);
    }
  }

  _showTooltip(rows, tsAt, area, w) {
    if (!rows.length) {
      this.tooltip.style.display = "none";
      return;
    }
    const fmtV = (v) => (this.unit === "%" ? v.toFixed(1) + "%" : v.toFixed(1) + " MB");
    const head = `<div class="tt-time">${fmtClockFull(rows[0].ts || tsAt)}</div>`;
    const body = rows
      .map(
        (r) =>
          `<div class="tt-row"><span class="tt-dot" style="background:${r.color}"></span>` +
          `<span class="tt-label">${r.label}</span><span class="tt-val">${fmtV(r.value)}</span></div>`
      )
      .join("");
    this.tooltip.innerHTML = head + body;
    this.tooltip.style.display = "block";
    // keep the tooltip inside the panel
    const px = Math.min(this.hoverX + 14, w - this.tooltip.offsetWidth - 8);
    this.tooltip.style.left = Math.max(6, px) + "px";
    this.tooltip.style.top = area.y + 6 + "px";
  }
}
