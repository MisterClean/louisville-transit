// Blue "Detour" badge for official TARC route-detour alerts (headline like
// "Route 71 detour"; see isDetourIncident). Distinct blue tone so it reads
// apart from the amber "Delays" badge. Presentational only: callers decide
// when to show it, additively alongside the live status pill / duration.
export default function DetourBadge() {
  return <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Detour</span>;
}
