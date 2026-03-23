export interface PromptVersion {
  id: number;
  prompt_type: string;
  version: number;
  name: string;
  content: string;
  status: 'draft' | 'testing' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface ComparisonMetrics {
  prompt_version_id: number;
  version_name: string;
  status: string;
  total_sessions: number;
  total_questions: number;
  idk_count: number;
  idk_rate: number;
  escalation_count: number;
  escalation_rate: number;
  avg_duration: number;
  avg_questions_per_session: number;
  avg_tokens: number;
}

export const PROMPT_VARIABLES: Record<string, { name: string; description: string }[]> = {
  system_prompt: [
    { name: 'question_titles_text', description: 'List of knowledge base question titles' },
    { name: 'kb_context', description: 'BM25 retrieval results from knowledge base' },
    { name: 'previous_queries', description: 'Search queries made earlier in the session' },
    { name: 'tool_usage_counts', description: 'Current count of each tool used' },
    { name: 'tool_limits', description: 'Maximum allowed uses per tool' },
  ],
  capability_explanation: [
    { name: 'conversation_text', description: 'Formatted conversation history' },
  ],
};
