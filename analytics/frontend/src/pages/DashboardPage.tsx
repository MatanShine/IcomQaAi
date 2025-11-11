import { useMemo, useState } from 'react';
import { useSummaryMetrics, useIdkSessions, MetricsQueryParams } from '../hooks/useMetrics';
import { KPIGrid } from '../components/KPIGrid';
import { IdkSessionsCard } from '../components/IdkSessionsCard';
import { TimeRangeSelector, TimeRange } from '../components/TimeRangeSelector';

const buildTimeRangeParams = (timeRange: TimeRange): MetricsQueryParams | undefined => {
  if (timeRange === 'all') {
    return undefined;
  }

  const now = new Date();
  const params: MetricsQueryParams = {
    to: now.toISOString(),
  };

  switch (timeRange) {
    case '24h':
      params.from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      break;
    case '7d':
      params.from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case '30d':
      params.from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      break;
    default:
      break;
  }

  return params;
};

export const DashboardPage = () => {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');

  const summaryParams = useMemo(() => buildTimeRangeParams(timeRange), [timeRange]);
  const { data: summary, isLoading: isSummaryLoading } = useSummaryMetrics(summaryParams);
  const { data: idkSessions, isLoading: isIdkLoading } = useIdkSessions(summaryParams);

  return (
    <div className="space-y-6">
      <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      <KPIGrid summary={summary} loading={isSummaryLoading} />
      <IdkSessionsCard sessions={idkSessions} loading={isIdkLoading} />
    </div>
  );
};