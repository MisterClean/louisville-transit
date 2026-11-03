import { useState } from 'react';
import { useRouteCatalog } from '../hooks/useRouteCatalog.js';

const linkClass = 'text-blue-600 hover:underline dark:text-blue-400';
const incidentExample =
  "curl -fsS https://tarctransitalerts.app/data/alerts-recent.json | jq '.incidents | length'";
const positionsExample = [
  '(',
  'set -e',
  'base=https://tarctransitalerts.app/data',
  'if ! curl -fsS "$base/positions/index.json" -o positions-index.json; then',
  '  echo "Position archive unavailable; try again later." >&2',
  '  exit 1',
  'fi',
  "manifest=$(jq -r '.path // empty' positions-index.json)",
  'if [ -z "$manifest" ]; then',
  '  echo "Position archive index has no manifest." >&2',
  '  exit 1',
  'fi',
  'curl -fsS "$base/$manifest" -o positions-manifest.json',
  "file=$(jq -r '.days[0].files.bus.path // empty' positions-manifest.json)",
  'if [ -z "$file" ]; then',
  '  echo "No completed days are listed yet."',
  'else',
  '  curl -fsS "$base/$file" -o positions.parquet',
  '  duckdb -c "SELECT count(*) AS observed_positions FROM read_parquet(\'positions.parquet\');"',
  'fi',
  ')',
].join('\n');

function CodeExample({ title, code }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      window.prompt('Copy this example', code);
    }
  }

  return (
    <details className="rounded-lg border border-slate-200 dark:border-gh-border">
      <summary className="cursor-pointer px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
        {title}
      </summary>
      <div className="border-t border-slate-200 px-4 py-3 dark:border-gh-border">
        <button
          type="button"
          onClick={copy}
          className="mb-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-gh-border dark:text-slate-100 dark:hover:bg-slate-700"
        >
          {copied ? 'Copied' : 'Copy example'}
        </button>
        <pre className="max-w-full overflow-x-auto rounded bg-slate-100 p-3 text-xs text-slate-800 dark:bg-gh-canvas dark:text-slate-100">
          <code>{code}</code>
        </pre>
      </div>
    </details>
  );
}

export default function SubscribeContent() {
  const [route, setRoute] = useState('');
  const catalog = useRouteCatalog();
  const feed = route ? '/feed/route/' + encodeURIComponent(route) + '.xml' : '/feed.xml';
  const jsonFeed = route ? '/feed/route/' + encodeURIComponent(route) + '.json' : '/feed.json';

  return (
    <div className="space-y-8 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <section aria-labelledby="subscribe-feeds" className="space-y-3">
        <h2
          id="subscribe-feeds"
          className="text-lg font-semibold text-slate-800 dark:text-slate-100"
        >
          Alert feeds
        </h2>
        <p>Follow service alerts in a feed reader. Choose all alerts or a TARC bus route.</p>
        <label className="block">
          Route{' '}
          <select
            aria-label="TARC route"
            value={route}
            onChange={(event) => setRoute(event.target.value)}
            className="ml-2 max-w-full rounded border border-slate-300 bg-white p-2 dark:bg-gh-surface"
          >
            <option value="">All routes</option>
            {catalog.routes.map((id) => (
              <option key={id} value={id}>
                {id} · {catalog.names[id]}
              </option>
            ))}
          </select>
        </label>
        <p>
          <a className={linkClass} href={feed}>
            Open Atom feed
          </a>
          {' · '}
          <a className={linkClass} href={jsonFeed}>
            Open JSON Feed
          </a>
        </p>
        <p>
          Official TARC rider notifications are available through{' '}
          <a
            className={linkClass}
            href="https://www.ridetarc.org/how-to-subscribe-for-new-rideralerts-notifications/"
          >
            TARC
          </a>
          .
        </p>
      </section>

      <section
        id="use-the-data"
        aria-labelledby="use-the-data-title"
        className="space-y-5 border-t border-slate-200 pt-7 dark:border-gh-border"
      >
        <h2
          id="use-the-data-title"
          className="text-lg font-semibold text-slate-800 dark:text-slate-100"
        >
          Use the data
        </h2>
        <section aria-labelledby="incidents-title" className="space-y-3">
          <h3 id="incidents-title" className="font-semibold text-slate-800 dark:text-slate-100">
            Incidents
          </h3>
          <p>
            <a className={linkClass} href="/data/alerts-recent.json">
              Recent incidents
            </a>{' '}
            includes active incidents and those first seen in the past 93 days. Actual history only
            goes back to when collection began. For older records, the{' '}
            <a className={linkClass} href="/data/alerts-index.json">
              archive index
            </a>{' '}
            lists monthly and route shards. Append a shard’s <code>url</code> to <code>/data/</code>{' '}
            to open it.
          </p>
          <p>
            Download the{' '}
            <a className={linkClass} href="/data/alerts.csv">
              incident CSV
            </a>{' '}
            for one row per exported incident in a spreadsheet or analysis tool. These JSON and CSV
            files provide structured incident data. The{' '}
            <a className={linkClass} href="/feed.xml">
              Atom
            </a>{' '}
            and route feeds provide up to 50 recent incident entries for subscriptions;{' '}
            <a className={linkClass} href="/feed.json">
              JSON Feed
            </a>{' '}
            and per-route <code>.json</code> feeds are also available.
          </p>
          <p>Coverage reflects observations collected by this service and may have gaps.</p>
          <CodeExample title="Count incidents in the recent JSON" code={incidentExample} />
        </section>

        <section
          aria-labelledby="positions-title"
          className="space-y-3 border-t border-slate-200 pt-5 dark:border-gh-border"
        >
          <h3 id="positions-title" className="font-semibold text-slate-800 dark:text-slate-100">
            Vehicle positions
          </h3>
          <p>
            The{' '}
            <a className={linkClass} href="/data/positions/index.json">
              position archive index
            </a>{' '}
            leads to daily TARC bus position files. The hourly archive job publishes collected
            observations for completed Louisville calendar days, midnight to midnight in{' '}
            <code>America/New_York</code>. The first day, November 2, 2026, is partial because
            collection began that day. Other days may also have gaps; a missing observation does not
            mean a bus did not run.
          </p>
          <p>
            These are Zstandard-compressed Parquet files, separate from the incident CSV. The index
            points to a checksum-addressed manifest. Its <code>days</code> list gives each date’s
            bus file path, row count, byte size, and SHA-256 checksum; the manifest also describes
            the schema. Append the manifest and file paths to <code>/data/</code> on this site.
            Check the listed checksums when validating downloads.
          </p>
          <p>
            If the index is unavailable, try again later. An empty <code>days</code> list means no
            completed day is published yet. Use a Parquet reader such as DuckDB to open a downloaded
            file; the example uses <code>curl</code>, <code>jq</code>, and DuckDB.
          </p>
          <CodeExample title="Find and read the latest listed day" code={positionsExample} />
        </section>
      </section>
    </div>
  );
}
