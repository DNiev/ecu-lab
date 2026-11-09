/**
 * Persistence adapter.
 *
 * The original build called `window.storage`, which only exists inside the Claude
 * Artifact sandbox. Everywhere else those calls threw and were silently swallowed by
 * a `try/catch`, so career stats never persisted and nothing said so.
 *
 * This picks the best backend available and degrades quietly to an in-memory store,
 * so the app works identically whether it is running as an artifact, on a static
 * host, or in a test with no DOM at all.
 */

const KEY = 'career';

/** Final fallback so the app still runs where no persistent backend exists. */
const memory = new Map();

/** @returns {'artifact'|'local'|'memory'} which backend is in use */
export function storageBackend() {
  if (typeof window !== 'undefined' && window.storage?.get && window.storage?.set) return 'artifact';
  try {
    if (typeof localStorage !== 'undefined') {
      // Safari in private mode exposes localStorage but throws on write, so probe it.
      const probe = '__ecu_lab_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return 'local';
    }
  } catch { /* fall through to memory */ }
  return 'memory';
}

/**
 * @typedef {object} Career
 * @property {number} best highest single Pull Score
 * @property {number} total sum of every Pull Score
 * @property {number} pulls how many pulls have been logged
 * @property {import('./ui/state/runLog.js').RunRecord[]} runs the banked run log,
 *   newest first. Validated as an array here and capped by its writer — this adapter
 *   deliberately knows nothing about RUN_LIMIT, which is a UI-layer policy.
 * @property {string|null} pinnedRunId the run pinned as the ghost comparison
 */

/** @type {Career} */
const EMPTY_CAREER = { best: 0, total: 0, pulls: 0, runs: [], pinnedRunId: null };

/**
 * Reads saved career stats.
 *
 * @returns {Promise<Career>} saved stats, or zeroes if nothing is stored yet
 */
export async function loadCareer() {
  try {
    let raw = null;
    switch (storageBackend()) {
      case 'artifact': raw = (await window.storage.get(KEY))?.value ?? null; break;
      case 'local': raw = localStorage.getItem(KEY); break;
      default: raw = memory.get(KEY) ?? null;
    }
    if (!raw) return { ...EMPTY_CAREER };
    const parsed = JSON.parse(raw);
    return {
      best: Number(parsed.best) || 0,
      total: Number(parsed.total) || 0,
      pulls: Number(parsed.pulls) || 0,
      // A save written before run history existed has neither key. Both coerce to the
      // empty case rather than to `undefined`, which the UI would call .find() on.
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      pinnedRunId: typeof parsed.pinnedRunId === 'string' ? parsed.pinnedRunId : null,
    };
  } catch {
    // A corrupt or unreadable save should never stop the app from starting.
    return { ...EMPTY_CAREER };
  }
}

/**
 * Writes career stats. Best-effort: a failure here must never interrupt play.
 *
 * @param {Partial<Career>} career
 * @returns {Promise<boolean>} whether the write succeeded
 */
export async function saveCareer(career) {
  const raw = JSON.stringify({
    best: career.best ?? 0,
    total: career.total ?? 0,
    pulls: career.pulls ?? 0,
    runs: Array.isArray(career.runs) ? career.runs : [],
    pinnedRunId: typeof career.pinnedRunId === 'string' ? career.pinnedRunId : null,
  });
  try {
    switch (storageBackend()) {
      case 'artifact': await window.storage.set(KEY, raw); return true;
      case 'local': localStorage.setItem(KEY, raw); return true;
      default: memory.set(KEY, raw); return true;
    }
  } catch {
    return false;
  }
}

/**
 * Clears saved career stats. Exposed for tests and for a future "reset career" button.
 * @returns {Promise<void>}
 */
export async function clearCareer() {
  try {
    switch (storageBackend()) {
      case 'artifact': await window.storage.set(KEY, ''); break;
      case 'local': localStorage.removeItem(KEY); break;
      default: memory.delete(KEY);
    }
  } catch { /* best-effort */ }
}

/** The career shop's save, kept apart from the pull stats above. */
const SHOP_KEY = 'shop';

/**
 * Reads the career shop's save.
 *
 * @returns {Promise<unknown>} the parsed save, or null if there is none or it is unreadable
 */
export async function loadShop() {
  try {
    let raw;
    switch (storageBackend()) {
      case 'artifact': raw = (await window.storage.get(SHOP_KEY))?.value ?? null; break;
      case 'local': raw = localStorage.getItem(SHOP_KEY); break;
      default: raw = memory.get(SHOP_KEY) ?? null;
    }
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Writes the career shop's save. Best-effort, like `saveCareer`.
 *
 * @param {unknown} shop
 * @returns {Promise<boolean>} whether it was written
 */
export async function saveShop(shop) {
  try {
    const raw = JSON.stringify(shop);
    switch (storageBackend()) {
      case 'artifact': await window.storage.set(SHOP_KEY, raw); return true;
      case 'local': localStorage.setItem(SHOP_KEY, raw); return true;
      default: memory.set(SHOP_KEY, raw); return true;
    }
  } catch {
    return false;
  }
}
