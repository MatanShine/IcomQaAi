import { useState, useEffect } from 'react';
import type { Comment, CreateCommentInput, UpdateCommentInput } from '../types/comments';

interface CommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateCommentInput | UpdateCommentInput) => Promise<void>;
  questionId: number;
  sessionId: string;
  initialData?: Comment | null;
}

export const CommentModal = ({
  isOpen,
  onClose,
  onSubmit,
  questionId,
  sessionId,
  initialData,
}: CommentModalProps) => {
  const [userName, setUserName] = useState('');
  const [isAnswerInDb, setIsAnswerInDb] = useState(false);
  const [isAnswerInContext, setIsAnswerInContext] = useState(false);
  const [issueDescription, setIssueDescription] = useState('');
  const [solutionSuggestion, setSolutionSuggestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) {
      setUserName(initialData.user_name);
      setIsAnswerInDb(initialData.is_answer_in_db);
      setIsAnswerInContext(initialData.is_answer_in_context);
      setIssueDescription(initialData.issue_description || '');
      setSolutionSuggestion(initialData.solution_suggestion || '');
    } else {
      setUserName('');
      setIsAnswerInDb(false);
      setIsAnswerInContext(false);
      setIssueDescription('');
      setSolutionSuggestion('');
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (initialData) {
        await onSubmit({
          user_name: userName,
          is_answer_in_db: isAnswerInDb,
          is_answer_in_context: isAnswerInContext,
          issue_description: issueDescription || null,
          solution_suggestion: solutionSuggestion || null,
        });
      } else {
        await onSubmit({
          user_name: userName,
          question_id: questionId,
          question_session_id: sessionId,
          is_answer_in_db: isAnswerInDb,
          is_answer_in_context: isAnswerInContext,
          issue_description: issueDescription || null,
          solution_suggestion: solutionSuggestion || null,
        });
      }
      onClose();
    } catch (error) {
      console.error('Error submitting comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            {initialData ? 'Edit Comment' : 'Add Comment'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="user_name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              User Name *
            </label>
            <input
              type="text"
              id="user_name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-600"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_answer_in_db"
                checked={isAnswerInDb}
                onChange={(e) => setIsAnswerInDb(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
              />
              <label htmlFor="is_answer_in_db" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Answer in DB
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_answer_in_context"
                checked={isAnswerInContext}
                onChange={(e) => setIsAnswerInContext(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
              />
              <label htmlFor="is_answer_in_context" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Answer in Context
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="issue_description" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Issue Description
            </label>
            <textarea
              id="issue_description"
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-600"
            />
          </div>

          <div>
            <label htmlFor="solution_suggestion" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Solution Suggestion
            </label>
            <textarea
              id="solution_suggestion"
              value={solutionSuggestion}
              onChange={(e) => setSolutionSuggestion(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-600"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !userName.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {isSubmitting ? 'Saving...' : initialData ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


