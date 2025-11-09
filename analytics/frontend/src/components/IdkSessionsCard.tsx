interface IdkSession {
  sessionId: string;
  idkCount: number;
}

interface Props {
  sessions?: IdkSession[];
  loading?: boolean;
}

export const IdkSessionsCard = ({ sessions, loading }: Props) => {
  if (loading) {
    return <div className="text-slate-400">Loading sessions...</div>;
  }

  if (!sessions?.length) {
    return <div className="text-slate-400">No sessions with "IDK" responses yet.</div>;
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Sessions with "IDK" Responses</h2>
      </div>
      <ul className="divide-y divide-slate-800">
        {sessions.map((session) => (
          <li key={session.sessionId} className="flex items-center justify-between px-6 py-4 text-sm text-slate-200">
            <span>{session.sessionId}</span>
            <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300">
              {session.idkCount} responses
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
