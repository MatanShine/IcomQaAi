import { useState } from 'react';

interface SessionMessage {
  id: number;
  question: string;
  answer: string;
  dateAsked: string | null;
}

interface IdkSession {
  sessionId: string;
  idkCount: number;
  latestId: number;
  messages: SessionMessage[];
}

interface Props {
  sessions?: IdkSession[];
  loading?: boolean;
}

export const IdkSessionsCard = ({ sessions, loading }: Props) => {
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  if (loading) {
    return <div className="text-slate-400">Loading sessions...</div>;
  }

  if (!sessions?.length) {
    return <div className="text-slate-400">No recent sessions available.</div>;
  }

  const toggleSession = (sessionId: string) => {
    setExpandedSession((current) => (current === sessionId ? null : sessionId));
  };

  const orderedSessions = [...sessions].sort((a, b) => b.latestId - a.latestId);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex flex-col gap-2 border-b border-slate-800 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-white">Recent Sessions</h2>
        <p className="text-xs uppercase tracking-wide text-slate-500">Top 5 most recent sessions by activity</p>
      </div>
      <ul className="divide-y divide-slate-800">
        {orderedSessions.map((session) => {
          const isExpanded = expandedSession === session.sessionId;

          return (
            <li key={session.sessionId} className="px-6 py-4">
              <button
                type="button"
                onClick={() => toggleSession(session.sessionId)}
                className="flex w-full items-center justify-between text-left text-sm text-slate-200"
              >
                <div>
                  <p className="font-medium text-white">Session {session.sessionId}</p>
                  <p className="text-xs text-slate-400">{session.idkCount} "IDK" responses</p>
                </div>
                <span className="text-xs text-slate-400">{isExpanded ? 'Hide' : 'View'}</span>
              </button>
              {isExpanded && (
                <div className="mt-4 space-y-4">
                  {session.messages.map((message) => (
                    <div key={message.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex flex-col gap-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Question</p>
                        <p className="text-sm text-white">{message.question}</p>
                      </div>
                      <div className="mt-3 flex flex-col gap-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Answer</p>
                        <p className="text-sm text-slate-200">{message.answer}</p>
                      </div>
                      {message.dateAsked && (
                        <p className="mt-3 text-xs text-slate-500">{new Date(message.dateAsked).toLocaleString()}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
