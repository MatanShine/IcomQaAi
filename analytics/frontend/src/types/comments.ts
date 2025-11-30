export interface Comment {
  id: number;
  user_name: string;
  question_id: number;
  question_session_id: string;
  is_answer_in_db: boolean;
  is_answer_in_context: boolean;
  date_added: string;
  is_bug_fixed: boolean;
  issue_description: string | null;
  solution_suggestion: string | null;
}

export interface CommentFilters {
  is_bug_fixed?: boolean;
  user_name?: string;
  from?: string;
  to?: string;
}

export interface CreateCommentInput {
  user_name: string;
  question_id: number;
  question_session_id: string;
  is_answer_in_db: boolean;
  is_answer_in_context: boolean;
  issue_description?: string | null;
  solution_suggestion?: string | null;
}

export interface UpdateCommentInput {
  user_name?: string;
  is_answer_in_db?: boolean;
  is_answer_in_context?: boolean;
  is_bug_fixed?: boolean;
  issue_description?: string | null;
  solution_suggestion?: string | null;
}


