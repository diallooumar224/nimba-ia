// Stockage local sécurisé (repli en mémoire si localStorage est indisponible)
const mem = new Map();
let ls = null;
try { const k = '__nimba_test__'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); ls = window.localStorage; } catch { ls = null; }

export const persistent = !!ls;

export function load(key, fallback) {
  try {
    const raw = ls ? ls.getItem('nimba:' + key) : mem.get(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  const raw = JSON.stringify(value);
  try { ls ? ls.setItem('nimba:' + key, raw) : mem.set(key, raw); }
  catch { mem.set(key, raw); }
}

export function wipe() {
  if (ls) Object.keys(ls).filter(k => k.startsWith('nimba:')).forEach(k => ls.removeItem(k));
  mem.clear();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
