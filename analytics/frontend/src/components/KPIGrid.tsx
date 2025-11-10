interface SummaryMetrics {
    totalQuestions: number;
    totalSessions: number;
    uniqueUsers: number;
    totalIdk: number;
    averageDuration: number;
    averageTokens: number;
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
        <KPICell label="Avg Tokens" value={summary.averageTokens.toFixed(2)} />
      </div>
    );
  };