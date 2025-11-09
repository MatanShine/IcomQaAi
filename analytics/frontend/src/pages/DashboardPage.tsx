import { useSummaryMetrics, useIdkSessions } from '../hooks/useMetrics';
import { KPIGrid } from '../components/KPIGrid';
import { IdkSessionsCard } from '../components/IdkSessionsCard';

export const DashboardPage = () => {
  const { data: summary, isLoading: isSummaryLoading } = useSummaryMetrics();
  const { data: idkSessions, isLoading: isIdkLoading } = useIdkSessions();

  return (
    <div className="space-y-6">
      <KPIGrid summary={summary} loading={isSummaryLoading} />
      <IdkSessionsCard sessions={idkSessions} loading={isIdkLoading} />
    </div>
  );
};
