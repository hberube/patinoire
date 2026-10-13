// Small shared helpers. `base` lets admin/ pages reuse these with "../".
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function fetchJson(path, base = "") {
  const res = await fetch(`${base}${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function headshot(id) {
  return `https://assets.nhle.com/mugs/nhl/latest/${encodeURIComponent(id)}.png`;
}

export function teamLogo(abbrev) {
  return `https://assets.nhle.com/logos/nhl/svg/${encodeURIComponent(abbrev)}_light.svg`;
}
