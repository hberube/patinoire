// Client-side PIN check against data/users.json (salted PBKDF2, see scripts/make_pins.py).
// This only identifies family members on the site; trades still need Hugo's approval.
import { fetchJson } from "./util.js";

const SESSION_KEY = "pool_session";
const ITERATIONS = 100000;

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
}

export async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin.trim()), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: ITERATIONS }, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
}

export function newSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
}

export async function login(participantId, pin, base = "") {
  const users = await fetchJson("data/users.json", base);
  const user = users.find(u => u.participantId === participantId);
  if (!user || (await hashPin(pin, user.salt)) !== user.pinHash) return null;
  const session = { participantId: user.participantId, displayName: user.displayName, role: user.role };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* private mode */ }
  return session;
}

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}

export function logout() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
