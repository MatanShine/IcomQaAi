interface SummaryMetrics {
  totalQuestions: number;
  totalSessions: number;
  uniqueUsers: number;
  totalIdk: number;
  averageDuration: number;
  averageTokensSent: number;
  averageTokensReceived: number;
  averageTotalTokens: number;
  percentSessionsWithSupportRequest: number;
  percentIdkMessages: number;
}

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

export const KPIGrid = ({ summary, loading }: Props) => {
  if (loading) {
    return <div className="text-slate-400">Loading metrics...</div>;
  }

  if (!summary) {
    return <div className="text-slate-400">No metrics available.</div>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KPICell label="Total Questions" value={summary.totalQuestions.toLocaleString()} />
      <KPICell label="Total Sessions" value={summary.totalSessions.toLocaleString()} />
      <KPICell label="Unique Users" value={summary.uniqueUsers.toLocaleString()} />
      <KPICell label='"IDK" Responses' value={summary.totalIdk.toLocaleString()} />
      <KPICell label="Avg Duration (s)" value={summary.averageDuration.toFixed(2)} />
      <KPICell label="Avg Sent Tokens" value={summary.averageTokensSent.toFixed(2)} />
      <KPICell label="Avg Received Tokens" value={summary.averageTokensReceived.toFixed(2)} />
      <KPICell label="Avg Total Tokens" value={summary.averageTotalTokens.toFixed(2)} />
      <KPICell
        label="Sessions with Support Request"
        value={`${summary.percentSessionsWithSupportRequest.toFixed(2)}%`}
      />
      <KPICell label='"IDK" Messages Share' value={`${summary.percentIdkMessages.toFixed(2)}%`} />
    </div>
  );
};
