import { useState, useMemo } from 'react';
import { useComments, useUpdateComment } from '../hooks/useComments';
import { useAllSessions } from '../hooks/useMetrics';
import type { Comment, CommentFilters, UpdateCommentInput } from '../types/comments';
import type { RecentSession } from '../hooks/useMetrics';
import { CommentModal } from '../components/CommentModal';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';

export const CommentsPage = () => {
  const [expandedCommentId, setExpandedCommentId] = useState<number | null>(null);
  const [editCommentId, setEditCommentId] = useState<number | null>(null);
  const [showSessionForCommentId, setShowSessionForCommentId] = useState<number | null>(null);
  const [showQuestionForCommentId, setShowQuestionForCommentId] = useState<number | null>(null);
  const [showContextForCommentId, setShowContextForCommentId] = useState<number | null>(null);
  
  // Filter states
  const [filterIsBugFixed, setFilterIsBugFixed] = useState<string>('all'); // 'all', 'true', 'false'
  const [filterUserName, setFilterUserName] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const { data: allSessions } = useAllSessions({});

  const filters: CommentFilters = useMemo(() => {
    const result: CommentFilters = {};
    if (filterIsBugFixed !== 'all') {
      result.is_bug_fixed = filterIsBugFixed === 'true';
    }
    if (filterUserName.trim()) {
      result.user_name = filterUserName.trim();
    }
    if (filterFrom) {
      result.from = filterFrom;
    }
    if (filterTo) {
      result.to = filterTo;
    }
    return result;
  }, [filterIsBugFixed, filterUserName, filterFrom, filterTo]);

  const { data: comments, isLoading } = useComments(filters);
  const updateCommentMutation = useUpdateComment();
  const { toasts, showToast, removeToast } = useToast();

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const handleToggleBugFixed = async (comment: Comment) => {
    const newValue = !comment.is_bug_fixed;
    await updateCommentMutation.mutateAsync({
      id: comment.id,
      data: { is_bug_fixed: newValue },
    });
  };

  const handleEditComment = (comment: Comment) => {
    setEditCommentId(comment.id);
  };

  const handleCloseEditModal = () => {
    setEditCommentId(null);
  };

  const handleSubmitEdit = async (data: UpdateCommentInput) => {
    if (editCommentId) {
      try {
        await updateCommentMutation.mutateAsync({
          id: editCommentId,
          data,
        });
        setEditCommentId(null);
        showToast('Comment updated successfully', 'success');
      } catch (error) {
        showToast('Failed to update comment', 'error');
      }
    }
  };

  const selectedComment = comments?.find((c) => c.id === editCommentId);

  const getSessionForComment = (comment: Comment): RecentSession | undefined => {
    return allSessions?.find((session) => session.sessionId === comment.question_session_id);
  };

  const getQuestionForComment = (comment: Comment) => {
    const session = getSessionForComment(comment);
    return session?.interactions.find((interaction) => interaction.id === comment.question_id);
  };

  const containsHebrew = (text: string | null | undefined): boolean => {
    if (!text) return false;
    return /[\u0590-\u05FF]/.test(text);
  };

  if (isLoading) {
    return <div className="text-slate-500 dark:text-slate-400">Loading comments...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Comments</h1>

      {/* Filter Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Filter by is_bug_fixed */}
            <div className="flex items-center gap-2">
              <label htmlFor="filter-bug-fixed" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Status:
              </label>
              <select
                id="filter-bug-fixed"
                value={filterIsBugFixed}
                onChange={(e) => setFilterIsBugFixed(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-600"
              >
                <option value="all">All</option>
                <option value="true">Fixed</option>
                <option value="false">Not Fixed</option>
              </select>
            </div>

            {/* Filter by user_name */}
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={filterUserName}
                onChange={(e) => setFilterUserName(e.target.value)}
                placeholder="Filter by user name..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-slate-700"
              />
            </div>

            {/* Date range filters */}
            <div className="flex items-center gap-2">
              <label htmlFor="filter-from" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                From:
              </label>
              <input
                type="date"
                id="filter-from"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="filter-to" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                To:
              </label>
              <input
                type="date"
                id="filter-to"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-600"
              />
            </div>
          </div>

          <div className="text-sm text-slate-600 dark:text-slate-400">
            Showing {comments?.length || 0} comment{comments?.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Comments List */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        {!comments || comments.length === 0 ? (
          <div className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
            No comments found.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {comments.map((comment) => {
              const isExpanded = expandedCommentId === comment.id;
              const isSessionVisible = showSessionForCommentId === comment.id;
              const isQuestionVisible = showQuestionForCommentId === comment.id;
              const isContextVisible = showContextForCommentId === comment.id;

              return (
                <li key={comment.id} className="text-sm text-slate-700 dark:text-slate-200">
                  <button
                    type="button"
                    onClick={() => setExpandedCommentId((current) => (current === comment.id ? null : comment.id))}
                    className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-slate-50 focus:outline-none dark:hover:bg-slate-900/60"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatTime(comment.date_added)}
                      </span>
                      {comment.issue_description && (
                        <p className="text-sm text-slate-700 dark:text-slate-200 line-clamp-1 flex-1">
                          {comment.issue_description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          comment.is_bug_fixed
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                        }`}
                      >
                        {comment.is_bug_fixed ? '✓ Fixed' : '✗ Not Fixed'}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          comment.is_answer_in_db
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {comment.is_answer_in_db ? 'In DB' : 'Not in DB'}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          comment.is_answer_in_context
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {comment.is_answer_in_context ? 'In Context' : 'Not in Context'}
                      </span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="space-y-4 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
                      {/* Comment Summary */}
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              User Name
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-200">{comment.user_name}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Date Added
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-200">
                              {formatTime(comment.date_added)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Answer in DB
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-200">
                              {comment.is_answer_in_db ? 'Yes' : 'No'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Answer in Context
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-200">
                              {comment.is_answer_in_context ? 'Yes' : 'No'}
                            </p>
                          </div>
                        </div>
                        {comment.issue_description && (
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                              Issue Description
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                              {comment.issue_description}
                            </p>
                          </div>
                        )}
                        {comment.solution_suggestion && (
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                              Solution Suggestion
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                              {comment.solution_suggestion}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Session History and Question/Context */}
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowSessionForCommentId((current) => (current === comment.id ? null : comment.id));
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            {isSessionVisible ? 'Hide Session' : 'Show Session'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowQuestionForCommentId((current) => (current === comment.id ? null : comment.id));
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            {isQuestionVisible ? 'Hide Question' : 'Show Question (and Answer)'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowContextForCommentId((current) => (current === comment.id ? null : comment.id));
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            {isContextVisible ? 'Hide Context' : 'Show Context'}
                          </button>
                        </div>
                        {isSessionVisible && (() => {
                          const session = getSessionForComment(comment);
                          if (!session) {
                            return (
                              <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                Session not found.
                              </div>
                            );
                          }
                          return (
                            <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Chat Session History
                              </p>
                              <div className="space-y-4">
                                {session.interactions.map((interaction) => {
                                  const isHighlighted = interaction.id === comment.question_id;
                                  return (
                                    <div
                                      key={interaction.id}
                                      className={`space-y-2 rounded-lg border p-3 ${
                                        isHighlighted
                                          ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                                          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40'
                                      }`}
                                    >
                                      {isHighlighted && (
                                        <div className="mb-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                                          Question ID: {interaction.id} (Commented)
                                        </div>
                                      )}
                                      <div>
                                        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                          Question
                                        </p>
                                        <p
                                          className={`text-sm text-slate-700 dark:text-slate-200 ${
                                            containsHebrew(interaction.question) ? 'text-right' : ''
                                          }`}
                                          dir={containsHebrew(interaction.question) ? 'rtl' : 'auto'}
                                        >
                                          {interaction.question}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                          Answer
                                        </p>
                                        <p
                                          className={`text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap ${
                                            containsHebrew(interaction.answer) ? 'text-right' : ''
                                          }`}
                                          dir={containsHebrew(interaction.answer) ? 'rtl' : 'auto'}
                                        >
                                          {interaction.answer}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Question and Answer */}
                        {isQuestionVisible && (() => {
                          const questionData = getQuestionForComment(comment);
                          if (!questionData) {
                            return (
                              <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                Question not found.
                              </div>
                            );
                          }
                          return (
                            <div className="mt-3 space-y-3 rounded-lg border border-blue-500 bg-blue-50 p-4 dark:border-blue-400 dark:bg-blue-900/20">
                              <div className="mb-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                                Question ID: {questionData.id}
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Question
                                </p>
                                <p
                                  className={`text-sm text-slate-700 dark:text-slate-200 ${
                                    containsHebrew(questionData.question) ? 'text-right' : ''
                                  }`}
                                  dir={containsHebrew(questionData.question) ? 'rtl' : 'auto'}
                                >
                                  {questionData.question}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Answer
                                </p>
                                <p
                                  className={`text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap ${
                                    containsHebrew(questionData.answer) ? 'text-right' : ''
                                  }`}
                                  dir={containsHebrew(questionData.answer) ? 'rtl' : 'auto'}
                                >
                                  {questionData.answer}
                                </p>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Context */}
                        {isContextVisible && (() => {
                          const questionData = getQuestionForComment(comment);
                          if (!questionData || !questionData.context) {
                            return (
                              <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                Context not available.
                              </div>
                            );
                          }
                          return (
                            <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Context
                              </p>
                              <div className="space-y-1">
                                {(() => {
                                  try {
                                    const contextData = JSON.parse(questionData.context || '{}');
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
                                        {questionData.context}
                                      </pre>
                                    );
                                  } catch (e) {
                                    return (
                                      <pre className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words" dir="auto">
                                        {questionData.context}
                                      </pre>
                                    );
                                  }
                                })()}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditComment(comment);
                          }}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          Edit Comment
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleBugFixed(comment);
                          }}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            comment.is_bug_fixed
                              ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:hover:bg-yellow-900/50'
                              : 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50'
                          }`}
                        >
                          {comment.is_bug_fixed ? '✗ Mark as Not Fixed' : '✓ Mark as Fixed'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editCommentId && selectedComment && (
        <CommentModal
          isOpen={!!editCommentId}
          onClose={handleCloseEditModal}
          onSubmit={handleSubmitEdit}
          questionId={selectedComment.question_id}
          sessionId={selectedComment.question_session_id}
          initialData={selectedComment}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
};

