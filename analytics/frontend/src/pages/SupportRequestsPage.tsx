import { useSupportRequests } from '../hooks/useSupportRequests';

export const SupportRequestsPage = () => {
  const { data, isLoading } = useSupportRequests();

  if (isLoading) {
    return <div className="text-slate-400">Loading support requests...</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Support Requests</h1>
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800">
          <thead className="bg-slate-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Session</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">User</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Theme</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {data?.map((request) => (
              <tr key={request.id}>
                <td className="px-4 py-3 text-sm text-slate-200">{request.session_id}</td>
                <td className="px-4 py-3 text-sm text-slate-200">{request.user_id ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-200">{request.theme ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-200">{request.status ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-200">
                  {request.date_added ? new Date(request.date_added).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};