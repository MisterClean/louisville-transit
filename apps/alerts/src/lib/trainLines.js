// TARC rail/streetcar line metadata, keyed by the normalized route key used
// in alerts.json. The filename remains trainLines.js for now to keep the port
// scoped; callers import TRAIN_LINES rather than TARC-specific names.
export const TRAIN_LINES = {};
export const TRAIN_LINE_ORDER = [];
const LINE_ALIAS = {};

/**
 * Normalize a TARC rail/streetcar route key. Unknown keys pass through
 * unchanged so stale links fail soft.
 *
 * @param {string} key
 * @returns {string}
 */
export function normalizeTrainLine(key) {
  if (key == null) return key;
  return LINE_ALIAS[key] ?? key;
}

export function isStreetcarRoute(key) {
  return normalizeTrainLine(key) === 'streetcar';
}
