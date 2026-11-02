import { useEffect, useMemo, useState } from 'react';
import { dataUrl } from '../lib/dataSource.js';

export default function LiveBuses() {
  const [data, setData] = useState(null);
  const [geometry, setGeometry] = useState(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch(dataUrl('vehicles.json'), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((value) => {
          if (active) setData(value);
        })
        .catch(() => {
          if (active) setData(null);
        });
    fetch(dataUrl('routes.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (active) setGeometry(value);
      })
      .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const vehicles = (data?.vehicles || []).filter(
    (v) => Number.isFinite(v.lat) && Number.isFinite(v.lon),
  );
  const project = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const include = (lon, lat) => {
      minX = Math.min(minX, lon);
      maxX = Math.max(maxX, lon);
      minY = Math.min(minY, lat);
      maxY = Math.max(maxY, lat);
    };
    for (const shape of Object.values(geometry?.shapes || {}))
      for (const [lon, lat] of shape.coordinates) include(lon, lat);
    for (const v of vehicles) include(v.lon, v.lat);
    if (!Number.isFinite(minX)) return () => [0, 0];
    const cos = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
    const width = (maxX - minX) * cos || 1;
    const height = maxY - minY || 1;
    const scale = Math.min(680 / width, 320 / height);
    return (lon, lat) => [
      360 + (lon - (minX + maxX) / 2) * cos * scale,
      180 - (lat - (minY + maxY) / 2) * scale,
    ];
  }, [geometry, vehicles]);
  if (!data) return null;
  const age = data.source_timestamp
    ? Math.max(0, Math.round((Date.now() - data.source_timestamp) / 60000))
    : null;
  return (
    <section className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 space-y-2">
      <h2 className="font-semibold text-slate-800 dark:text-slate-100">Live buses</h2>
      <p className="text-xs text-slate-500">
        {vehicles.length} reported buses{age == null ? '' : ` · feed ${age} min old`}. Positions can
        be delayed.
      </p>
      {vehicles.length > 0 && (
        <svg
          viewBox="0 0 720 360"
          className="w-full bg-slate-50 dark:bg-gh-canvas rounded"
          role="img"
          aria-label="Reported TARC bus positions in the Louisville area"
        >
          {Object.entries(geometry?.shapes || {}).map(([id, shape]) => (
            <polyline
              key={id}
              points={shape.coordinates.map(([lon, lat]) => project(lon, lat).join(',')).join(' ')}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="1"
            />
          ))}
          {vehicles.map((v) => (
            <circle
              key={v.id}
              cx={project(v.lon, v.lat)[0]}
              cy={project(v.lon, v.lat)[1]}
              r="5"
              fill="#2563eb"
            >
              <title>Route {v.route || 'unknown'}</title>
            </circle>
          ))}
        </svg>
      )}
    </section>
  );
}
