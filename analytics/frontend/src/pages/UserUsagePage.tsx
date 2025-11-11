import React, { useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useThemeUsageStats, ThemeUsageStats, useUsersByTheme, UserThemeStats } from '../hooks/useMetrics';
import { useTimeRange, TimeRangeKey } from '../hooks/useTimeRange';

const formatNumber = (value: number) => value.toLocaleString();

type ChartMetric = 'users' | 'sessions' | 'questions' | 'idk' | 'supportRequests';

interface MetricOption {
  value: ChartMetric;
  label: string;
  key: keyof ThemeUsageStats;
}

const metricOptions: MetricOption[] = [
  { value: 'users', label: 'Users', key: 'userCount' },
  { value: 'sessions', label: 'Sessions', key: 'sessionCount' },
  { value: 'questions', label: 'Questions', key: 'questionCount' },
  { value: 'idk', label: 'IDK', key: 'idkCount' },
  { value: 'supportRequests', label: 'Support Requests', key: 'supportRequestCount' },
];

const ThemeTag = ({ color, label, value }: { color: string; label: string; value: number }) => (
  <span
    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${color}`}
    title={label}
  >
    <span className="font-semibold">{label}:</span>
    <span className="ml-1">{formatNumber(value)}</span>
  </span>
);

const UserTag = ({ color, label, value }: { color: string; label: string; value: number }) => (
  <span
    className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${color}`}
    title={label}
  >
    <span className="font-semibold">{label}:</span>
    <span className="ml-1">{formatNumber(value)}</span>
  </span>
);

const UserListItem = ({ user }: { user: UserThemeStats }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">{user.userId}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <UserTag
          color="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
          label="Sessions"
          value={user.sessionCount}
        />
        <UserTag
          color="bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300"
          label="Questions"
          value={user.questionCount}
        />
        <UserTag
          color="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
          label="IDK"
          value={user.idkCount}
        />
        <UserTag
          color="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
          label="Support Requests"
          value={user.supportRequestCount}
        />
      </div>
    </div>
  </div>
);

const ThemeListItem = ({
  theme,
  stats,
  index,
  scrollRef,
  filters,
  isExpanded,
  onToggle,
}: {
  theme: string;
  stats: ThemeUsageStats;
  index: number;
  scrollRef: (element: HTMLElement | null) => void;
  filters: { from?: string; to?: string };
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const { data: users, isLoading: isLoadingUsers } = useUsersByTheme(isExpanded ? theme : null, filters);

  return (
    <div
      ref={scrollRef}
      className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div
        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">#{index + 1}</span>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{theme}</h3>
          <svg
            className={`w-5 h-5 text-slate-500 dark:text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeTag
            color="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
            label="Users"
            value={stats.userCount}
          />
          <ThemeTag
            color="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
            label="Sessions"
            value={stats.sessionCount}
          />
          <ThemeTag
            color="bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300"
            label="Questions"
            value={stats.questionCount}
          />
          <ThemeTag
            color="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
            label="IDK"
            value={stats.idkCount}
          />
          <ThemeTag
            color="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
            label="Support Requests"
            value={stats.supportRequestCount}
          />
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-slate-200 p-4 dark:border-slate-700">
          {isLoadingUsers ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">Loading users...</div>
          ) : users && users.length > 0 ? (
            <div className="space-y-2">
              <h4 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
                Users ({users.length})
              </h4>
              {users.map((user) => (
                <UserListItem key={user.userId} user={user} />
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500 dark:text-slate-400">No users found for this theme.</div>
          )}
        </div>
      )}
    </div>
  );
};

const TopThemesChart = ({
  themes,
  onThemeClick,
  metric,
}: {
  themes: ThemeUsageStats[];
  onThemeClick: (theme: string) => void;
  metric: ChartMetric;
}) => {
  const metricOption = metricOptions.find((opt) => opt.value === metric) || metricOptions[2];
  const dataKey = metricOption.key;
  const metricLabel = metricOption.label;

  // Sort themes by the selected metric and take top 20
  const sortedThemes = [...themes].sort((a, b) => {
    const aValue = a[dataKey] as number;
    const bValue = b[dataKey] as number;
    return bValue - aValue;
  });

  const chartData = sortedThemes.slice(0, 20).map((item) => ({
    name: item.theme,
    value: item[dataKey] as number,
  }));

  // Custom tick component for clickable theme names
  const CustomYAxisTick = ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={4}
          textAnchor="end"
          fill="#64748b"
          fontSize={12}
          style={{ cursor: 'pointer' }}
          onClick={() => onThemeClick(payload.value)}
          onMouseEnter={(e) => {
            e.currentTarget.setAttribute('fill', '#2563eb');
            e.currentTarget.setAttribute('text-decoration', 'underline');
          }}
          onMouseLeave={(e) => {
            e.currentTarget.setAttribute('fill', '#64748b');
            e.currentTarget.setAttribute('text-decoration', 'none');
          }}
        >
          {payload.value}
        </text>
      </g>
    );
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/40">
      <h2 className="mb-6 text-xl font-semibold text-slate-900 dark:text-white">
        Top 20 Themes by {metricLabel}
      </h2>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        Click on a theme name or bar to scroll to it in the list below
      </p>
      <ResponsiveContainer width="100%" height={600}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 150, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" />
          <XAxis type="number" stroke="#64748b" className="dark:stroke-slate-400" />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            stroke="#64748b"
            tick={CustomYAxisTick}
            className="dark:stroke-slate-400"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#1e293b', fontWeight: 'bold' }}
            formatter={(value: number) => [formatNumber(value), metricLabel]}
          />
          <Bar
            dataKey="value"
            fill="#1e40af"
            radius={[0, 4, 4, 0]}
            onClick={(data: any) => {
              if (data && data.name) {
                onThemeClick(data.name);
              }
            }}
            className="cursor-pointer hover:opacity-80"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill="#1e40af" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const UserUsagePage = () => {
  const { timeRange, setTimeRange, filters, options } = useTimeRange('all');
  const { data: themeStats, isLoading } = useThemeUsageStats(filters);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('questions');
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const themeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setThemeRef = (theme: string) => (element: HTMLDivElement | null) => {
    if (element) {
      themeRefs.current.set(theme, element);
    } else {
      themeRefs.current.delete(theme);
    }
  };

  const scrollToTheme = (theme: string) => {
    const element = themeRefs.current.get(theme);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Expand the theme when scrolled to
      setExpandedThemes((prev) => new Set(prev).add(theme));
    }
  };

  const toggleTheme = (theme: string) => {
    setExpandedThemes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(theme)) {
        newSet.delete(theme);
      } else {
        newSet.add(theme);
      }
      return newSet;
    });
  };

  const renderFilters = () => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
      <label className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
        <span>Chart Metric</span>
        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-slate-700"
          value={chartMetric}
          onChange={(event) => setChartMetric(event.target.value as ChartMetric)}
        >
          {metricOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">User Usage</h1>
          {renderFilters()}
        </div>
        <div className="text-slate-500 dark:text-slate-400">Loading theme usage statistics...</div>
      </div>
    );
  }

  if (!themeStats || themeStats.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">User Usage</h1>
          {renderFilters()}
        </div>
        <div className="text-slate-500 dark:text-slate-400">No theme usage statistics available.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">User Usage</h1>
        {renderFilters()}
      </div>

      {/* Top 20 Themes Chart */}
      <TopThemesChart themes={themeStats} onThemeClick={scrollToTheme} metric={chartMetric} />

      {/* All Themes List */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">All Themes</h2>
        <div className="space-y-3">
          {themeStats.map((stats, index) => (
            <ThemeListItem
              key={stats.theme}
              theme={stats.theme}
              stats={stats}
              index={index}
              scrollRef={setThemeRef(stats.theme)}
              filters={filters}
              isExpanded={expandedThemes.has(stats.theme)}
              onToggle={() => toggleTheme(stats.theme)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

