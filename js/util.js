// Small shared helpers. `base` lets admin/ pages reuse these with "../".

// Where data/ and img/ are: "" on the live site; the dev preview (dev/, scripts/dev_publish.sh)
// sets window.POOL_ROOT = "../" so it shows the live data with the code being tested
export const ROOT = globalThis.POOL_ROOT || "";
export const asset = p => (!p || /^([a-z]+:|\/)/i.test(p) ? p : ROOT + p);
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function fetchJson(path, base = ROOT) {
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
