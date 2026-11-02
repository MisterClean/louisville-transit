import { useState } from 'react';
import { useRouteCatalog } from '../hooks/useRouteCatalog.js';

export default function SubscribeContent() {
  const [route, setRoute] = useState('');
  const catalog = useRouteCatalog();
  const feed = route ? `/feed/route/${encodeURIComponent(route)}.xml` : '/feed.xml';
  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
      <p>Follow service alerts in a feed reader. Choose all alerts or a TARC bus route.</p>
      <label className="block">
        Route{' '}
        <select
          aria-label="TARC route"
          value={route}
          onChange={(event) => setRoute(event.target.value)}
          className="ml-2 rounded border border-slate-300 bg-white p-2 dark:bg-gh-surface"
        >
          <option value="">All routes</option>
          {catalog.routes.map((id) => (
            <option key={id} value={id}>
              {id} · {catalog.names[id]}
            </option>
          ))}
        </select>
      </label>
      <a className="text-blue-500 hover:underline" href={feed}>
        Open Atom feed
      </a>
      <p>
        Official TARC rider notifications are available through{' '}
        <a
          className="text-blue-500 hover:underline"
          href="https://www.ridetarc.org/how-to-subscribe-for-new-rideralerts-notifications/"
        >
          TARC
        </a>
        .
      </p>
    </div>
  );
}
