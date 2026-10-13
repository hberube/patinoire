// Points trajectory: every team as a muted context line, up to 3 highlighted teams in
// series colours with end labels, plus a crosshair tooltip. Plain SVG, no library.
import { esc } from "./util.js";

const SLOTS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const NS = "http://www.w3.org/2000/svg";

export function renderChart(el, { dates, series, highlighted, fmtDay, labelFor }) {
  const W = Math.max(320, el.clientWidth - 12);
  const H = Math.round(Math.min(440, Math.max(260, W * 0.5)));
  const m = { top: 14, right: W < 520 ? 16 : 130, bottom: 28, left: 40 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const n = dates.length;
  if (n < 2) { el.innerHTML = `<div class="empty">—</div>`; return; }

  const step = niceStep(Math.max(1, ...series.flatMap(s => s.values.filter(v => v != null))) / 4);
  const maxY = step * Math.ceil(Math.max(1, ...series.flatMap(s => s.values.filter(v => v != null))) / step);
  const x = i => m.left + (i / (n - 1)) * iw;
  const y = v => m.top + ih - (v / maxY) * ih;
  const path = vals => vals.map((v, i) => v == null ? "" : `${i && vals[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const hl = highlighted.map((id, k) => ({ s: series.find(s => s.id === id), color: SLOTS[k] })).filter(h => h.s);
  const ticks = Array.from({ length: Math.round(maxY / step) + 1 }, (_, k) => k * step);
  const xTicks = pickXTicks(n, W < 520 ? 4 : 7);

  let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(hl.map(h => labelFor(h.s)).join(", "))}">`;
  svg += `<g class="grid">${ticks.map(t => `<line x1="${m.left}" x2="${m.left + iw}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>`;
  svg += `<g class="axis">${ticks.map(t => `<text x="${m.left - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("")}`;
  svg += xTicks.map(i => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(fmtDay(dates[i]))}</text>`).join("") + `</g>`;
  svg += series.filter(s => !highlighted.includes(s.id)).map(s => `<path class="ctx" d="${path(s.values)}"/>`).join("");
  svg += hl.map(h => `<path class="hl" stroke="${h.color}" d="${path(h.s.values)}"/>`).join("");

  // End labels (desktop): nudge apart so they never overlap
  if (m.right > 40) {
    const ends = hl.map(h => ({ h, v: lastVal(h.s.values) })).sort((a, b) => b.v - a.v);
    let prevY = -Infinity;
    for (const e of ends) {
      const ly = Math.max(y(e.v) + 4, prevY + 15);
      prevY = ly;
      svg += `<text class="end-label" x="${m.left + iw + 8}" y="${ly}">${esc(trunc(labelFor(e.h.s), 16))} · ${e.v}</text>`;
    }
  }
  svg += `<g class="hover" visibility="hidden"><line class="cross" y1="${m.top}" y2="${m.top + ih}"/>${hl.map(h => `<circle class="dot" r="4.5" fill="${h.color}"/>`).join("")}</g>`;
  svg += `<rect class="hit" x="${m.left}" y="${m.top}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  el.innerHTML = svg + `<div class="tooltip hidden"></div>`;

  // Crosshair + tooltip
  const root = el.querySelector("svg"), hover = root.querySelector(".hover"), tip = el.querySelector(".tooltip");
  const line = hover.querySelector("line"), dots = hover.querySelectorAll("circle");
  const move = evt => {
    const pt = root.createSVGPoint();
    const src = evt.touches ? evt.touches[0] : evt;
    pt.x = src.clientX; pt.y = src.clientY;
    const p = pt.matrixTransform(root.getScreenCTM().inverse());
    const i = Math.max(0, Math.min(n - 1, Math.round(((p.x - m.left) / iw) * (n - 1))));
    hover.setAttribute("visibility", "visible");
    line.setAttribute("x1", x(i)); line.setAttribute("x2", x(i));
    hl.forEach((h, k) => {
      const v = h.s.values[i];
      dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", v == null ? -99 : y(v));
    });
    const ranked = series.map(s => s.values[i]).filter(v => v != null).sort((a, b) => b - a);
    tip.innerHTML = `<div class="tt-date">${esc(fmtDay(dates[i], true))}</div>` + hl.map(h => {
      const v = h.s.values[i];
      return `<div class="tt-row"><span class="swatch" style="background:${h.color}"></span><span style="flex:1">${esc(trunc(labelFor(h.s), 22))}</span><b class="num">${v ?? "—"}</b><span class="muted num">#${ranked.indexOf(v) + 1}</span></div>`;
    }).join("");
    tip.classList.remove("hidden");
    const box = el.getBoundingClientRect(), px = (x(i) / W) * box.width;
    tip.style.left = `${Math.min(box.width - tip.offsetWidth - 8, Math.max(8, px + 14))}px`;
    tip.style.top = `${12}px`;
  };
  const leave = () => { hover.setAttribute("visibility", "hidden"); tip.classList.add("hidden"); };
  const hit = root.querySelector(".hit");
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerleave", leave);
  hit.addEventListener("touchmove", move, { passive: true });
  return hl.map(h => ({ id: h.s.id, color: h.color }));
}

function lastVal(vals) {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return vals[i];
  return 0;
}

// 1, 2, 2.5 or 5 times a power of ten
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
}

function pickXTicks(n, count) {
  if (n <= count) return [...Array(n).keys()];
  return [...Array(count).keys()].map(k => Math.round((k / (count - 1)) * (n - 1)));
}

function trunc(s, len) {
  return s.length > len ? s.slice(0, len - 1) + "…" : s;
}
