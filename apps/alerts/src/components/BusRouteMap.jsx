import { useEffect, useMemo, useState } from 'react';
import { dataUrl } from '../lib/dataSource.js';

export default function BusRouteMap({ route }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    fetch(dataUrl('routes.json'))
      .then((res) => (res.ok ? res.json() : null))
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const paths = useMemo(() => {
    const shapes = Object.entries(data?.shapes || {}).filter(
      ([, shape]) => String(shape.route) === String(route) && shape.coordinates?.length > 1,
    );
    if (!shapes.length) return [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, shape] of shapes)
      for (const [x, y] of shape.coordinates) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    const cos = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
    const scale = Math.min(680 / ((maxX - minX) * cos || 1), 260 / (maxY - minY || 1));
    return shapes.map(([id, shape]) => ({
      id,
      points: shape.coordinates
        .map(
          ([x, y]) =>
            `${360 + (x - (minX + maxX) / 2) * cos * scale},${150 - (y - (minY + maxY) / 2) * scale}`,
        )
        .join(' '),
    }));
  }, [data, route]);
  if (!paths.length) return null;
  return (
    <section className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
      <h2 className="font-semibold text-slate-800 dark:text-slate-100">Route map</h2>
      <p className="text-xs text-slate-500">Route shapes from the TARC schedule.</p>
      <svg viewBox="0 0 720 300" className="w-full" role="img" aria-label={`Map of route ${route}`}>
        {paths.map((path) => (
          <polyline
            key={path.id}
            points={path.points}
            fill="none"
            stroke="#2563eb"
            strokeWidth="3"
          />
        ))}
      </svg>
    </section>
  );
}
