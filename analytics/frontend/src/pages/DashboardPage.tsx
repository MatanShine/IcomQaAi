import { KPIGrid } from '../components/KPIGrid';
import { RecentSessionsCard } from '../components/RecentSessionsCard';
import { useRecentSessions, useSummaryMetrics, usePreviousPeriodMetrics } from '../hooks/useMetrics';
import { TimeRangeKey, useTimeRange } from '../hooks/useTimeRange';

export const DashboardPage = () => {
  const { timeRange, setTimeRange, filters, previousPeriodFilters, options } = useTimeRange('all');

  const { data: summary, isLoading: isSummaryLoading } = useSummaryMetrics(filters);
  const { data: previousSummary, isLoading: isPreviousLoading } = usePreviousPeriodMetrics(previousPeriodFilters);
  const { data: recentSessions, isLoading: isSessionsLoading } = useRecentSessions({});

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Dashboard</h1>
        <label className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <span>Time Range</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-slate-700"
            value={timeRange}
            onChange={(event) => setTimeRange(event.target.value as TimeRangeKey)}
          >
            {Object.entries(options).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <KPIGrid 
        summary={summary} 
        previousSummary={previousSummary ?? undefined}
        loading={isSummaryLoading || isPreviousLoading} 
      />
      <RecentSessionsCard sessions={recentSessions} loading={isSessionsLoading} />
    </div>
  );
};
