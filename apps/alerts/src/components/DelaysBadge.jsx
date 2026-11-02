// Amber "Delays" badge for delay-classified incidents — set by the producer as
// `status.type === 'delay'` (an official TARC alert reporting delays, or a bot
// headway gap; see export-web.js and isDelayIncident). The TARC analog of CTA's
// Metra "delayed" status badge. Presentational only: callers decide when to show
// it (additively, alongside the live "ongoing" pill / duration).
export default function DelaysBadge() {
  return <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Delays</span>;
}
