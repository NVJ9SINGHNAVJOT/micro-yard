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
  track: "#262a32",
  grid: "rgba(255,255,255,0.06)",
  text: "#f2f4f8",
  muted: "#868e9c",
  faint: "#5c6473",
  surface: "#16181d",
};

// UI_FONT matches the dashboard's body face so canvas text sits with the DOM.
const UI_FONT = '"Inter", system-ui, -apple-system, sans-serif';

// lighten mixes a hex color toward white by amt (0..1) for gauge arc gradients.
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

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
// The backing store is sized to the element × devicePixelRatio so the arc and
// centered value stay crisp on HiDPI displays.
function drawGauge(canvas, pct, base, label) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 116;
  const px = Math.round(size * dpr);
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = size, h = size;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 11;
  ctx.clearRect(0, 0, w, h);

  const start = Math.PI * 0.75;
  const end = Math.PI * 2.25;
  const clamped = Math.max(0, Math.min(100, pct || 0));

  ctx.lineWidth = 9;
  ctx.lineCap = "round";

  // recessive track
  ctx.beginPath();
  ctx.strokeStyle = COLORS.track;
  ctx.arc(cx, cy, r, start, end);
  ctx.stroke();

  if (pct != null && clamped > 0) {
    const col = pickColor(base, clamped);
    const sweepEnd = start + (end - start) * (clamped / 100);
    // subtle gradient from a lighter shade into the base for depth
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, lighten(col, 0.28));
    grad.addColorStop(1, col);
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.strokeStyle = grad;
    ctx.arc(cx, cy, r, start, sweepEnd);
    ctx.stroke();
    ctx.restore();
  }

  // centered value: big number + small unit, or muted "n/a"
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (pct == null) {
    ctx.fillStyle = COLORS.faint;
    ctx.font = `500 15px ${UI_FONT}`;
    ctx.fillText(label, cx, cy);
    return;
  }
  const m = /^(\d+)(\D+)?$/.exec(label);
  const num = m ? m[1] : label;
  const unit = m && m[2] ? m[2] : "";
  ctx.fillStyle = COLORS.text;
  const numFont = `700 27px ${UI_FONT}`;
  const unitFont = `600 13px ${UI_FONT}`;
  ctx.font = numFont;
  const numW = ctx.measureText(num).width;
  ctx.font = unitFont;
  const unitW = unit ? ctx.measureText(unit).width + 2 : 0;
  const startX = cx - (numW + unitW) / 2;
  ctx.textAlign = "left";
  ctx.font = numFont;
  ctx.fillText(num, startX, cy + 1);
  if (unit) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = unitFont;
    ctx.fillText(unit, startX + numW + 2, cy + 2);
  }
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

    // horizontal gridlines + y labels (recessive, hairline)
    ctx.fillStyle = COLORS.faint;
    ctx.lineWidth = 1;
    ctx.font = `10px ${UI_FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const gy = Math.round(area.y + (area.h / 4) * i) + 0.5;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(area.x, gy);
      ctx.lineTo(area.x + area.w, gy);
      ctx.stroke();
      const val = yMax * (1 - i / 4);
      // small auto-scaled ranges need a decimal so ticks don't collide (2,1,1,0)
      ctx.fillText(yMax >= 10 ? Math.round(val) + "" : val.toFixed(1), area.x - 8, gy);
    }

    // x time labels (start / mid / end)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const frac of [0, 0.5, 1]) {
      const ts = this.t0 + (this.t1 - this.t0) * frac;
      const x = area.x + area.w * frac;
      ctx.fillText(fmtClock(ts), Math.min(Math.max(x, area.x + 14), area.x + area.w - 14), area.y + area.h + 7);
    }

    if (!this.series.length || !this.series.some((s) => s.points.length)) {
      ctx.fillStyle = COLORS.faint;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `12px ${UI_FONT}`;
      ctx.fillText("No data in range", area.x + area.w / 2, area.y + area.h / 2);
      return;
    }

    // spike lines with a soft vertical-gradient area fill
    for (const s of this.series) {
      if (!s.points.length) continue;
      const trace = () => {
        s.points.forEach((p, i) => {
          const x = this._xOf(p.ts, area);
          const y = this._yOf(p.value, area, yMax);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
      };

      // area fill: series hue fading to transparent toward the baseline
      const fill = ctx.createLinearGradient(0, area.y, 0, area.y + area.h);
      fill.addColorStop(0, this._rgba(s.color, 0.22));
      fill.addColorStop(1, this._rgba(s.color, 0));
      ctx.beginPath();
      trace();
      ctx.lineTo(this._xOf(s.points[s.points.length - 1].ts, area), area.y + area.h);
      ctx.lineTo(this._xOf(s.points[0].ts, area), area.y + area.h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // 2px line on top
      ctx.beginPath();
      trace();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // hover scrub: crosshair + surface-ringed dots
    if (this.hoverX != null && this.hoverX >= area.x && this.hoverX <= area.x + area.w) {
      const tsAt = this.t0 + ((this.hoverX - area.x) / area.w) * (this.t1 - this.t0);
      ctx.strokeStyle = COLORS.faint;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.hoverX, area.y);
      ctx.lineTo(this.hoverX, area.y + area.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      const rows = [];
      for (const s of this.series) {
        const p = nearestPoint(s.points, tsAt);
        if (!p) continue;
        const cx = this._xOf(p.ts, area);
        const cy = this._yOf(p.value, area, yMax);
        // 2px surface ring so the dot stays legible over any line
        ctx.beginPath();
        ctx.fillStyle = COLORS.surface;
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = s.color;
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fill();
        rows.push({ color: s.color, label: s.label, value: p.value, ts: p.ts });
      }
      this._showTooltip(rows, tsAt, area, w);
    }
  }

  // _rgba converts a #rrggbb color to an rgba() string at the given alpha.
  _rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
