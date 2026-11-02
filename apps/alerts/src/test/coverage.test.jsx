import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SummaryStats from '../components/SummaryStats.jsx';
import {
  buildWeekSummary,
  computeDisruptionMinutes,
  computeLineReliability,
  computeStatsLeaderboards,
  hasWindowCoverage,
  weekStartUTC,
} from '../lib/aggregate.js';
import { buildCalendarMonths } from '../lib/calendar.js';
import { atlantaDayUTC } from '../lib/format.js';

const NOW = Date.UTC(2026, 10, 2, 21),
  DAY = 86400000;
const cold = { now: NOW, dataStartTs: NOW - 15 * 60000, coverageDays: [] };
describe('observed coverage and cold-start metrics', () => {
  it('route and compare helpers never fill unknown90days with clean days or a30day denominator', () => {
    expect(computeLineReliability([], [], { ...cold, windowDays: 90 })).toBeNull();
    expect(computeDisruptionMinutes([], [], { ...cold, windowDays: 30 })).toBeNull();
    expect(computeStatsLeaderboards([], [], { ...cold, windowDays: 90 })).toBeNull();
  });
  it('archive age alone does not qualify outage days as observed', () => {
    expect(hasWindowCoverage(NOW - 400 * DAY, 90, NOW, [])).toBe(false);
    const days = Array.from({ length: 90 }, (_, i) =>
      new Date(atlantaDayUTC(NOW) - (i + 1) * DAY).toISOString().slice(0, 10),
    );
    expect(hasWindowCoverage(NOW - 400 * DAY, 90, NOW, days)).toBe(true);
    expect(
      computeLineReliability([], [], {
        now: NOW,
        windowDays: 90,
        dataStartTs: NOW - 400 * DAY,
        coverageDays: days,
      }),
    ).toMatchObject({ totalDays: 90, incidentFreeDays: 90 });
    expect(hasWindowCoverage(NOW - 400 * DAY, 90, NOW, days.slice(1))).toBe(false);
  });
  it('cold-start stats show collecting instead of misleading full-period percentages', () => {
    render(
      <SummaryStats {...cold} activeCount={0} weeklyCount={0} alerts={[]} observations={[]} />,
    );
    expect(screen.getByText(/Collecting history/)).toBeTruthy();
    expect(screen.queryByText(/in last7days/)).toBeNull();
  });
  it('week recap and prior-week comparison require genuinely observed days', () => {
    const week = weekStartUTC(atlantaDayUTC(NOW));
    expect(buildWeekSummary([], [], week, NOW, cold)).toBeNull();
    const covered = Array.from({ length: 7 }, (_, i) =>
      new Date(week + i * DAY).toISOString().slice(0, 10),
    );
    const recap = buildWeekSummary([], [], week, NOW, {
      dataStartTs: week - 60 * DAY,
      coverageDays: covered,
    });
    expect(recap.priorTotal).toBeNull();
  });
  it('calendar marks precollection and outage days unknown rather than zero', () => {
    const [month] = buildCalendarMonths([], { ...cold, monthsBack: 1 });
    expect(month.cells.find((d) => d.dayOfMonth === 1).noData).toBe(true);
  });
});
