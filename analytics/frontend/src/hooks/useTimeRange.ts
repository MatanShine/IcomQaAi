import { useMemo, useState } from 'react';
import { MetricsFilters } from './useMetrics';

export type TimeRangeKey = '24h' | '7d' | '30d' | 'all';

export const TIME_RANGE_OPTIONS: Record<TimeRangeKey, { label: string; milliseconds?: number }> = {
  '24h': { label: 'Last 24H', milliseconds: 24 * 60 * 60 * 1000 },
  '7d': { label: 'Last 7D', milliseconds: 7 * 24 * 60 * 60 * 1000 },
  '30d': { label: 'Last 30D', milliseconds: 30 * 24 * 60 * 60 * 1000 },
  'all': { label: 'All' },
};

const buildFilters = (timeRange: TimeRangeKey): MetricsFilters => {
  if (timeRange === 'all') {
    return {};
  }

  const option = TIME_RANGE_OPTIONS[timeRange];
  const to = new Date();
  const from = new Date(to.getTime() - (option.milliseconds ?? 0));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
};

const buildPreviousPeriodFilters = (timeRange: TimeRangeKey): MetricsFilters | null => {
  if (timeRange === 'all') {
    return null;
  }

  const option = TIME_RANGE_OPTIONS[timeRange];
  const to = new Date();
  const from = new Date(to.getTime() - (option.milliseconds ?? 0));
  const previousTo = from;
  const previousFrom = new Date(previousTo.getTime() - (option.milliseconds ?? 0));

  return {
    from: previousFrom.toISOString(),
    to: previousTo.toISOString(),
  };
};

export const useTimeRange = (defaultRange: TimeRangeKey = 'all') => {
  const [timeRange, setTimeRange] = useState<TimeRangeKey>(defaultRange);

  const filters = useMemo(() => buildFilters(timeRange), [timeRange]);
  const previousPeriodFilters = useMemo(() => buildPreviousPeriodFilters(timeRange), [timeRange]);

  return {
    timeRange,
    setTimeRange,
    filters,
    previousPeriodFilters,
    options: TIME_RANGE_OPTIONS,
  };
};

