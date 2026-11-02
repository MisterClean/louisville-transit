// Fetches the per-incident vehicle-position "track" used by EventReplay to
// animate trains across the schematic. Tracks are archived to the R2 data
// origin (same place alerts.json lives) under tracks/<eventId>.json before the
// 7-day raw-observation rolloff drops the positions. Most events won't have one
// (older than the archiver, or buses), so a 404 is the normal "no replay" case
// — callers treat null as "render nothing."
import { dataUrl } from './dataSource.js';

/**
 * @param {string} eventId
 * @returns {Promise<object|null>} the track payload, or null if none exists.
 */
export async function fetchEventTrack(eventId) {
  if (!eventId) return null;
  try {
    const res = await fetch(dataUrl(`tracks/${eventId}.json`), { cache: 'force-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
