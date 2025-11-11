import { useState, useMemo } from 'react';
import { useAllSessions } from '../hooks/useMetrics';
import type { RecentSession } from '../hooks/useMetrics';

export const ChatHistoryPage = () => {
  const { data: allSessions, isLoading } = useAllSessions({});
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [showContext, setShowContext] = useState<Record<number, boolean>>({});
  
  // Filter states
  const [filterIdk, setFilterIdk] = useState(false);
  const [filterSupportRequest, setFilterSupportRequest] = useState(false);
  const [searchText, setSearchText] = useState('');

  const countIdkAnswers = (interactions: RecentSession['interactions']) => {
    return interactions.filter((interaction) =>
      interaction.answer.toLowerCase().includes('idk')
    ).length;
  };

  const formatTime = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const containsHebrew = (text: string | null | undefined): boolean => {
    if (!text) return false;
    // Hebrew Unicode range: \u0590-\u05FF
    return /[\u0590-\u05FF]/.test(text);
  };

  const toggleContext = (interactionId: number) => {
    setShowContext((prev) => ({
      ...prev,
      [interactionId]: !prev[interactionId],
    }));
  };

  const filteredSessions = useMemo(() => {
    if (!allSessions) return [];

    return allSessions.filter((session) => {
      // Filter by IDK
      if (filterIdk) {
        const idkCount = countIdkAnswers(session.interactions);
        if (idkCount === 0) return false;
      }

      // Filter by support request
      if (filterSupportRequest && !session.hasSupportRequest) {
        return false;
      }

      // Filter by search text in questions
      if (searchText.trim()) {
        const hasMatchingQuestion = session.interactions.some((interaction) =>
          interaction.question.toLowerCase().includes(searchText.toLowerCase())
        );
        if (!hasMatchingQuestion) return false;
      }

      return true;
    });
  }, [allSessions, filterIdk, filterSupportRequest, searchText]);

  if (isLoading) {
    return <div className="text-slate-500 dark:text-slate-400">Loading chat history...</div>;
  }

  if (!allSessions?.length) {
    return <div className="text-slate-500 dark:text-slate-400">No chat history available.</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Chat History</h1>

      {/* Search and Filter Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search by question text */}
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search in questions..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-slate-700"
              />
            </div>

            {/* Filter by IDK */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="filter-idk"
                checked={filterIdk}
                onChange={(e) => setFilterIdk(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
              />
              <label
                htmlFor="filter-idk"
                className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Contains IDK
              </label>
            </div>

            {/* Filter by Support Request */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="filter-support-request"
                checked={filterSupportRequest}
                onChange={(e) => setFilterSupportRequest(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
              />
              <label
                htmlFor="filter-support-request"
                className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Opened Support Request
              </label>
            </div>
          </div>

          <div className="text-sm text-slate-600 dark:text-slate-400">
            Showing {filteredSessions.length} of {allSessions.length} sessions
          </div>
        </div>
      </div>

      {/* Sessions List */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {filteredSessions.map((session) => {
            const isExpanded = expandedSessionId === session.sessionId;
            const idkCount = countIdkAnswers(session.interactions);
            const formattedTime = formatTime(session.lastQuestionTime);

            return (
              <li key={session.sessionId} className="text-sm text-slate-700 dark:text-slate-200">
                <button
                  type="button"
                  onClick={() => setExpandedSessionId((current) => (current === session.sessionId ? null : session.sessionId))}
                  className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-slate-50 focus:outline-none dark:hover:bg-slate-900/60"
                >
                  <div className="flex items-center gap-4">
                    {formattedTime && (
                      <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formattedTime}
                      </span>
                    )}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">
                          {session.userId || 'Unknown User'}
                        </span>
                        {session.theme && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">• {session.theme}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={session.hasSupportRequest ? "rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800 dark:bg-red-900/30 dark:text-red-300" : "invisible rounded-full px-3 py-1 text-xs font-semibold"}>
                      Support Request Opened
                    </span>
                    <span className={idkCount > 0 ? "rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" : "invisible rounded-full px-3 py-1 text-xs font-semibold"}>
                      IDK: {idkCount || 0}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {session.interactions.length} messages
                    </span>
                  </div>
                </button>
                {isExpanded ? (
                  <div className="space-y-4 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
                    {session.interactions.map((interaction) => {
                      const isContextVisible = showContext[interaction.id];
                      const hasContext = interaction.context && interaction.context.trim() !== '';

                      return (
                        <div key={interaction.id} className="space-y-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500">Question</p>
                            <p 
                              className={`text-sm text-slate-700 dark:text-slate-200 ${containsHebrew(interaction.question) ? 'text-right' : ''}`}
                              dir={containsHebrew(interaction.question) ? 'rtl' : 'auto'}
                            >
                              {interaction.question}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500">Answer</p>
                            <p 
                              className={`text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap ${containsHebrew(interaction.answer) ? 'text-right' : ''}`}
                              dir={containsHebrew(interaction.answer) ? 'rtl' : 'auto'}
                            >
                              {interaction.answer}
                            </p>
                          </div>
                          {hasContext && (
                            <div>
                              <button
                                type="button"
                                onClick={() => toggleContext(interaction.id)}
                                className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                              >
                                {isContextVisible ? '▼ Hide Context' : '▶ Show Context'}
                              </button>
                              {isContextVisible && (
                                <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Context</p>
                                  <div className="space-y-1">
                                    {(() => {
                                      try {
                                        const contextData = JSON.parse(interaction.context || '{}');
                                        const entries = Object.entries(contextData);
                                        
                                        const validEntries = entries
                                          .filter(([, value]) => Array.isArray(value) && value.length >= 3)
                                          .map(([id, value], index) => {
                                            const question = value[0] || '';
                                            const link = (value as string[])[(value as string[]).length - 1] || '';
                                            
                                            return (
                                              <div key={id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 pb-1 last:border-b-0">
                                                <span className="font-medium text-slate-500 dark:text-slate-400 w-6 text-left">{index + 1}</span>
                                                <span 
                                                  className={`flex-1 ${containsHebrew(question) ? 'text-right' : ''}`}
                                                  dir={containsHebrew(question) ? 'rtl' : 'auto'}
                                                >
                                                  {question}
                                                </span>
                                                {link && (
                                                  <a
                                                    href={link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline whitespace-nowrap"
                                                  >
                                                    Link
                                                  </a>
                                                )}
                                              </div>
                                            );
                                          });
                                        
                                        return validEntries.length > 0 ? validEntries : (
                                          <pre className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words" dir="auto">
                                            {interaction.context}
                                          </pre>
                                        );
                                      } catch (e) {
                                        return (
                                          <pre className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words" dir="auto">
                                            {interaction.context}
                                          </pre>
                                        );
                                      }
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

