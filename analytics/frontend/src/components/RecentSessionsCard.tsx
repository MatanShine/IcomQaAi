import { useState } from 'react';
import type { RecentSession } from '../hooks/useMetrics';

interface Props {
  sessions?: RecentSession[];
  loading?: boolean;
}

export const RecentSessionsCard = ({ sessions, loading }: Props) => {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  if (loading) {
    return <div className="text-slate-400">Loading recent sessions...</div>;
  }

  if (!sessions?.length) {
    return <div className="text-slate-400">No recent sessions available.</div>;
  }

  const toggleSession = (sessionId: string) => {
    setExpandedSessionId((current) => (current === sessionId ? null : sessionId));
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Recent Sessions</h2>
        <p className="mt-1 text-sm text-slate-400">Most recent five sessions ordered by latest interaction.</p>
      </div>
      <ul className="divide-y divide-slate-800">
        {sessions.map((session) => {
          const isExpanded = expandedSessionId === session.sessionId;

          return (
            <li key={session.sessionId} className="text-sm text-slate-200">
              <button
                type="button"
                onClick={() => toggleSession(session.sessionId)}
                className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-slate-900/60 focus:outline-none"
              >
                <span className="font-medium text-white">{session.sessionId}</span>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                  {session.interactions.length} messages
                </span>
              </button>
              {isExpanded ? (
                <div className="space-y-4 border-t border-slate-800 bg-slate-950 px-6 py-4">
                  {session.interactions.map((interaction) => (
                    <div key={interaction.id} className="space-y-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Question</p>
                        <p className="text-sm text-slate-200">{interaction.question}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Answer</p>
                        <p className="text-sm text-slate-200">{interaction.answer}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
