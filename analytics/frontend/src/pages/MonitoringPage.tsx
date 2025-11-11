import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useHourlyMetrics } from '../hooks/useMetrics';
import { useTimeRange, TimeRangeKey } from '../hooks/useTimeRange';

// Helper function to format values based on data key
const formatValue = (value: number, dataKey: string, entryName?: string): string => {
  // Format duration fields with 2 decimal places
  // Check by dataKey first, then by name as fallback
  const isDuration = dataKey === 'maxDuration' || 
                     dataKey === 'minDuration' || 
                     dataKey === 'averageDuration' ||
                     (entryName && entryName.toLowerCase().includes('duration'));
  
  if (isDuration) {
    return value.toFixed(2);
  }
  // Format other numeric values as integers
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

// Custom tooltip
const CustomTooltip = ({ active, payload, label, timeRange, dataKeys }: any) => {
  if (active && payload && payload.length) {
    // Get the hour from the payload data (payload contains the full data object)
    const dataPoint = payload[0]?.payload;
    const hourValue = dataPoint?.hour;
    
    if (!hourValue) {
      return null;
    }
    
    const date = new Date(hourValue);
    
    // Check if the date is valid
    if (isNaN(date.getTime())) {
      return null;
    }
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    
    // For daily aggregation (30D, All), don't show hour
    const isDaily = timeRange === '30d' || timeRange === 'all';
    const formattedDate = isDaily 
      ? `${year}:${month}:${day}`
      : `${year}:${month}:${day}:${hour}`;
    
    // Create a map of name to dataKey for easy lookup
    const nameToKeyMap = new Map(dataKeys?.map((dk: { key: string; name: string }) => [dk.name, dk.key]) || []);
    
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-2 font-semibold text-slate-900 dark:text-white">{formattedDate}</p>
        {payload.map((entry: any, index: number) => {
          // Find the dataKey by matching the entry name from our dataKeys array
          const dataKey = nameToKeyMap.get(entry.name) || entry.dataKey || '';
          const formattedValue = formatValue(entry.value, dataKey, entry.name);
          return (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {formattedValue}
            </p>
          );
        })}
      </div>
    );
  }
  return null;
};

// Chart component
const MonitorChart = ({
  title,
  data,
  dataKeys,
  colors,
  timeRange,
  yAxisLabel,
}: {
  title: string;
  data: any[];
  dataKeys: { key: string; name: string }[];
  colors: string[];
  timeRange: TimeRangeKey;
  yAxisLabel?: string;
}) => {
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex-shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="p-4" style={{ height: '400px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 30, right: 20, left: yAxisLabel ? 50 : 30, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" />
            <XAxis 
              dataKey="hour" 
              hide={true}
            />
            <YAxis 
              stroke="#64748b" 
              className="dark:stroke-slate-400"
              width={yAxisLabel ? 50 : 40}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } } : undefined}
              tickFormatter={(value) => {
                // Check if any dataKey is a duration field
                const hasDuration = dataKeys.some((dk: { key: string }) => 
                  dk.key === 'maxDuration' || dk.key === 'minDuration' || dk.key === 'averageDuration'
                );
                if (hasDuration) {
                  return value.toFixed(1);
                }
                return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
              }}
            />
            <Tooltip content={<CustomTooltip timeRange={timeRange} dataKeys={dataKeys} />} />
            <Legend 
              wrapperStyle={{ paddingTop: '5px', paddingBottom: '5px' }}
              iconType="line"
              verticalAlign="top"
            />
            {dataKeys.map((dataKey, index) => (
              <Line
                key={dataKey.key}
                type="monotone"
                dataKey={dataKey.key}
                name={dataKey.name}
                stroke={colors[index]}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const MonitoringPage = () => {
  const { timeRange, setTimeRange, filters, options } = useTimeRange('24h');
  const { data: hourlyMetrics, isLoading } = useHourlyMetrics(filters, timeRange);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Monitoring</h1>
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">Time Range</label>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-slate-700"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRangeKey)}
            >
              {Object.entries(options).map(([value, option]) => (
                <option key={value} value={value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-slate-500 dark:text-slate-400">Loading monitoring data...</div>
      </div>
    );
  }

  if (!hourlyMetrics || hourlyMetrics.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Monitoring</h1>
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">Time Range</label>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-slate-700"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRangeKey)}
            >
              {Object.entries(options).map(([value, option]) => (
                <option key={value} value={value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-slate-500 dark:text-slate-400">No monitoring data available.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Monitoring</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-600 dark:text-slate-300">Time Range</label>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-slate-700"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRangeKey)}
          >
            {Object.entries(options).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {/* Chart 1: Questions and Sessions */}
        <MonitorChart
          title={timeRange === '30d' || timeRange === 'all' ? 'Questions and Sessions per Day' : 'Questions and Sessions per Hour'}
          data={hourlyMetrics}
          dataKeys={[
            { key: 'questions', name: 'Questions' },
            { key: 'sessions', name: 'Sessions' },
          ]}
          colors={['#3b82f6', '#eab308']}
          timeRange={timeRange}
        />

        {/* Chart 2: Max and Min Duration */}
        <MonitorChart
          title={timeRange === '30d' || timeRange === 'all' ? 'Max and Min Duration per Day' : 'Max and Min Duration per Hour'}
          data={hourlyMetrics}
          dataKeys={[
            { key: 'maxDuration', name: 'Max Duration' },
            { key: 'minDuration', name: 'Min Duration' },
          ]}
          colors={['#3b82f6', '#eab308']}
          timeRange={timeRange}
        />

        {/* Chart 3: IDK and Support Requests */}
        <MonitorChart
          title={timeRange === '30d' || timeRange === 'all' ? 'IDK and Support Requests per Day' : 'IDK and Support Requests per Hour'}
          data={hourlyMetrics}
          dataKeys={[
            { key: 'idk', name: 'IDK' },
            { key: 'supportRequests', name: 'Support Requests' },
          ]}
          colors={['#3b82f6', '#eab308']}
          timeRange={timeRange}
        />

        {/* Chart 4: Tokens */}
        <MonitorChart
          title={timeRange === '30d' || timeRange === 'all' ? 'Tokens per Day' : 'Tokens per Hour'}
          data={hourlyMetrics}
          dataKeys={[
            { key: 'tokensSent', name: 'Sent' },
            { key: 'tokensReceived', name: 'Received' },
            { key: 'tokensTotal', name: 'Total' },
          ]}
          colors={['#eab308', '#22c55e', '#3b82f6']}
          timeRange={timeRange}
        />
      </div>
    </div>
  );
};

