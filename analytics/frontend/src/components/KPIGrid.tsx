import type { SummaryMetrics } from '../hooks/useMetrics';

interface Props {
  summary?: SummaryMetrics;
  previousSummary?: SummaryMetrics;
  loading?: boolean;
}

interface DiffResult {
  formatted: string;
  color: string;
  arrow: string;
}

const calculateQuantityDiff = (current: number, previous: number | undefined): DiffResult | null => {
  if (previous === undefined) return null;
  
  const diff = current - previous;
  if (diff === 0) {
    return {
      formatted: '±0',
      color: 'text-slate-500 dark:text-slate-400',
      arrow: '-',
    };
  }
  
  const isPositive = diff > 0;
  const color = isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  const arrow = isPositive ? '↑' : '↓';
  const sign = isPositive ? '+' : '-';
  
  return {
    formatted: `${sign}${Math.abs(diff).toFixed(0)}`,
    color,
    arrow,
  };
};

const calculatePercentageDiff = (current: number, previous: number | undefined): DiffResult | null => {
  if (previous === undefined) return null;
  
  const diff = current - previous;
  if (diff === 0) {
    return {
      formatted: '±0',
      color: 'text-slate-500 dark:text-slate-400',
      arrow: '-',
    };
  }
  
  const isPositive = diff > 0;
  const color = isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  const arrow = isPositive ? '↑' : '↓';
  const sign = isPositive ? '+' : '';
  
  return {
    formatted: `${sign}${diff.toFixed(2)}`,
    color,
    arrow,
  };
};

interface KPICellProps {
  label: string;
  value: string;
  diff?: DiffResult | null;
}

const KPICell = ({ label, value, diff }: KPICellProps) => (
  <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/40">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
    <div className="mt-3 flex items-baseline gap-2">
      <p className="text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
      {diff && (
        <span className={`flex items-center gap-1 text-sm font-medium ${diff.color}`}>
          <span>{diff.formatted}</span>
          <span>{diff.arrow}</span>
        </span>
      )}
    </div>
  </div>
);

const formatNumber = (value: number) => value.toLocaleString();
const formatDecimal = (value: number) => value.toFixed(2);
const formatPercentage = (value: number) => `${value.toFixed(2)}%`;

export const KPIGrid = ({ summary, previousSummary, loading }: Props) => {
  if (loading) {
    return <div className="text-slate-500 dark:text-slate-400">Loading metrics...</div>;
  }

  if (!summary) {
    return <div className="text-slate-500 dark:text-slate-400">No metrics available.</div>;
  }

  return (
    <div className="space-y-4">
      {/* First row: Quantity metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICell 
          label="Total Questions" 
          value={formatNumber(summary.totalQuestions)}
          diff={calculateQuantityDiff(summary.totalQuestions, previousSummary?.totalQuestions)}
        />
        <KPICell 
          label="Total Sessions" 
          value={formatNumber(summary.totalSessions)}
          diff={calculateQuantityDiff(summary.totalSessions, previousSummary?.totalSessions)}
        />
        <KPICell 
          label="Unique Users" 
          value={formatNumber(summary.uniqueUsers)}
          diff={calculateQuantityDiff(summary.uniqueUsers, previousSummary?.uniqueUsers)}
        />
        <KPICell 
          label='"IDK" Responses' 
          value={formatNumber(summary.totalIdk)}
          diff={calculateQuantityDiff(summary.totalIdk, previousSummary?.totalIdk)}
        />
      </div>

      {/* Second row: Tokens metrics and duration */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICell 
          label="Avg Duration (s)" 
          value={formatDecimal(summary.averageDuration)}
          diff={calculateQuantityDiff(summary.averageDuration, previousSummary?.averageDuration)}
        />
        <KPICell 
          label="Avg Questions per Session" 
          value={formatDecimal(summary.averageQuestionsPerSession)}
          diff={calculateQuantityDiff(summary.averageQuestionsPerSession, previousSummary?.averageQuestionsPerSession)}
        />
        <KPICell 
          label="Avg IDK per Session" 
          value={formatDecimal(summary.averageIdkPerSession)}
          diff={calculateQuantityDiff(summary.averageIdkPerSession, previousSummary?.averageIdkPerSession)}
        />
        <KPICell 
          label="Avg Total Tokens" 
          value={formatDecimal(summary.averageTotalTokens)}
          diff={calculateQuantityDiff(summary.averageTotalTokens, previousSummary?.averageTotalTokens)}
        />
      </div>

      {/* Third row: Percentage metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICell 
          label='"IDK" answers % of total answers' 
          value={formatPercentage(summary.idkMessagePercentage)}
          diff={calculatePercentageDiff(summary.idkMessagePercentage, previousSummary?.idkMessagePercentage)}
        />
        <KPICell
          label="Support Request % of total sessions"
          value={formatPercentage(summary.supportRequestSessionPercentage)}
          diff={calculatePercentageDiff(summary.supportRequestSessionPercentage, previousSummary?.supportRequestSessionPercentage)}
        />
        <KPICell
          label="% of Sessions that contain IDK answers"
          value={formatPercentage(summary.idkSessionPercentage)}
          diff={calculatePercentageDiff(summary.idkSessionPercentage, previousSummary?.idkSessionPercentage)}
        />
        <KPICell
          label="% Sessions with IDK and Support Request"
          value={formatPercentage(summary.idkAndSupportRequestSessionPercentage)}
          diff={calculatePercentageDiff(summary.idkAndSupportRequestSessionPercentage, previousSummary?.idkAndSupportRequestSessionPercentage)}
        />
      </div>
    </div>
  );
};
