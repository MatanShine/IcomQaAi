import { ChangeEvent } from 'react';

export type TimeRange = '24h' | '7d' | '30d' | 'all';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

const OPTIONS: Array<{ label: string; value: TimeRange }> = [
  { label: 'Last 24 Hours', value: '24h' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'All Time', value: 'all' },
];

export const TimeRangeSelector = ({ value, onChange }: TimeRangeSelectorProps) => {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value as TimeRange);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      <label htmlFor="time-range" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Time Range
      </label>
      <select
        id="time-range"
        value={value}
        onChange={handleChange}
        className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-slate-600 sm:w-48"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};
