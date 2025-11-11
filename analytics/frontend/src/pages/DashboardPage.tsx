import { useMemo, useState } from 'react';
import { KPIGrid } from '../components/KPIGrid';
import { RecentSessionsCard } from '../components/RecentSessionsCard';
import { MetricsFilters, useRecentSessions, useSummaryMetrics } from '../hooks/useMetrics';

type TimeRangeKey = '24h' | '7d' | '30d';

const TIME_RANGE_OPTIONS: Record<TimeRangeKey, { label: string; milliseconds: number }> = {
  '24h': { label: 'Last 24H', milliseconds: 24 * 60 * 60 * 1000 },
  '7d': { label: 'Last 7D', milliseconds: 7 * 24 * 60 * 60 * 1000 },
  '30d': { label: 'Last 30D', milliseconds: 30 * 24 * 60 * 60 * 1000 },
};

const buildFilters = (timeRange: TimeRangeKey): MetricsFilters => {
  const option = TIME_RANGE_OPTIONS[timeRange];
  const to = new Date();
  const from = new Date(to.getTime() - option.milliseconds);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
};

export const DashboardPage = () => {
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('24h');

  const filters = useMemo(() => buildFilters(timeRange), [timeRange]);

  const { data: summary, isLoading: isSummaryLoading } = useSummaryMetrics(filters);
  const { data: recentSessions, isLoading: isSessionsLoading } = useRecentSessions(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <span>Time Range</span>
          <select
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-slate-700 focus:outline-none"
            value={timeRange}
            onChange={(event) => setTimeRange(event.target.value as TimeRangeKey)}
          >
            {Object.entries(TIME_RANGE_OPTIONS).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <KPIGrid summary={summary} loading={isSummaryLoading} />
      <RecentSessionsCard sessions={recentSessions} loading={isSessionsLoading} />
    </div>
  );
};
