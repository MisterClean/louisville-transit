import { useEffect, useState } from 'react';
import { loadRecent } from '../lib/incidentStore.js';
import { incidentRecords } from '../lib/incidents.js';

// Load the recent slice purely to populate the Header's Browse menu on pages
// whose own content doesn't already fetch it (the calendar and the A–Z index
// pages). The menu's dynamic sections (top bus routes / stations) are all
// 90-day-windowed, so the 93-day recent slice covers them without the
// full-history file. Returns incident-derived official/detection records, or
// nulls until the fetch resolves. Best-effort: a failed fetch just leaves those
// sections empty rather than surfacing an error.
export function useBrowseData() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    loadRecent()
      .then((payload) => {
        if (alive) setData(payload?.incidents ? incidentRecords(payload.incidents) : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return {
    officialRecords: data?.officialRecords ?? null,
    detectionRecords: data?.detectionRecords ?? null,
  };
}
