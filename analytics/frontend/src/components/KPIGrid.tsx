import type { SummaryMetrics } from '../hooks/useMetrics';

interface Props {
  summary?: SummaryMetrics;
  loading?: boolean;
}

const KPICell = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
  </div>
);

const formatNumber = (value: number) => value.toLocaleString();
const formatDecimal = (value: number) => value.toFixed(2);
const formatPercentage = (value: number) => `${value.toFixed(2)}%`;

export const KPIGrid = ({ summary, loading }: Props) => {
  if (loading) {
    return <div className="text-slate-400">Loading metrics...</div>;
  }

  if (!summary) {
    return <div className="text-slate-400">No metrics available.</div>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KPICell label="Total Questions" value={formatNumber(summary.totalQuestions)} />
      <KPICell label="Total Sessions" value={formatNumber(summary.totalSessions)} />
      <KPICell label="Unique Users" value={formatNumber(summary.uniqueUsers)} />
      <KPICell label='"IDK" Responses' value={formatNumber(summary.totalIdk)} />
      <KPICell label='"IDK" Message %' value={formatPercentage(summary.idkMessagePercentage)} />
      <KPICell label="Avg Duration (s)" value={formatDecimal(summary.averageDuration)} />
      <KPICell label="Avg Sent Tokens" value={formatDecimal(summary.averageSentTokens)} />
      <KPICell label="Avg Received Tokens" value={formatDecimal(summary.averageReceivedTokens)} />
      <KPICell label="Avg Total Tokens" value={formatDecimal(summary.averageTotalTokens)} />
      <KPICell
        label="Sessions w/ Support Request %"
        value={formatPercentage(summary.supportRequestSessionPercentage)}
      />
    </div>
  );
};
