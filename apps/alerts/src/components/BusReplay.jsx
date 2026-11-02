import { useEffect, useMemo, useState } from 'react';
import { fetchEventTrack } from '../lib/eventTracks.js';

// Project the published GTFS route shapes and observed positions into a shared SVG.
export default function BusReplay({ eventId }) {
  const [track, setTrack] = useState(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let active = true;
    fetchEventTrack(eventId).then((result) => {
      if (active && result?.mode === 'bus') setTrack(result);
    });
    return () => {
      active = false;
    };
  }, [eventId]);
  useEffect(() => {
    if (!playing || !track) return undefined;
    const timer = setInterval(
      () =>
        setTime((t) => {
          if (t + 30 >= track.durSec) {
            setPlaying(false);
            return track.durSec;
          }
          return t + 30;
        }),
      500,
    );
    return () => clearInterval(timer);
  }, [playing, track]);
  const map = useMemo(() => {
    if (!track) return null;
    const shapes = (track.shapes || []).filter((shape) => shape.coordinates?.length > 1);
    const points = shapes.flatMap((shape) => shape.coordinates);
    if (!points.length) return null;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of points) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const scale = Math.min(680 / ((maxLon - minLon) * cos || 1), 260 / (maxLat - minLat || 1));
    const project = ([lon, lat]) => [
      360 + (lon - (minLon + maxLon) / 2) * cos * scale,
      150 - (lat - (minLat + maxLat) / 2) * scale,
    ];
    return {
      shapes: shapes.map((shape) => ({ id: shape.id, points: shape.coordinates.map(project) })),
      project,
    };
  }, [track]);
  if (!track || !map) return null;
  const vehicles = (track.vehicles || [])
    .map((vehicle) => {
      const sample = [...(vehicle.s || [])]
        .reverse()
        .find((point) => point[0] <= time && time - point[0] <= 120);
      return sample ? { id: vehicle.id, point: map.project([sample[2], sample[1]]) } : null;
    })
    .filter(Boolean);
  const clock = new Date(track.t0 + time * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
  return (
    <section className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 space-y-3">
      <h2 className="font-semibold text-slate-800 dark:text-slate-100">Vehicle replay</h2>
      <p className="text-xs text-slate-500">
        Observed bus positions on published route shapes. Gaps in the feed are not interpolated.
      </p>
      <svg
        viewBox="0 0 720 300"
        className="w-full"
        role="img"
        aria-label={`Route ${track.route} vehicle positions at ${clock}`}
      >
        {map.shapes.map((shape) => (
          <polyline
            key={shape.id}
            points={shape.points.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke="#94a3b8"
            strokeWidth="3"
          />
        ))}
        {vehicles.map((vehicle) => (
          <circle
            key={vehicle.id}
            cx={vehicle.point[0]}
            cy={vehicle.point[1]}
            r="5"
            fill="#2563eb"
          />
        ))}
      </svg>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-slate-100 px-3 py-1 text-sm dark:bg-gh-subtle"
          onClick={() => {
            if (time >= track.durSec) setTime(0);
            setPlaying(!playing);
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          aria-label="Replay time"
          type="range"
          min="0"
          max={track.durSec}
          value={time}
          onChange={(event) => {
            setPlaying(false);
            setTime(Number(event.target.value));
          }}
          className="flex-1"
        />
        <time className="text-sm tabular-nums">{clock} ET</time>
      </div>
    </section>
  );
}
