import { useEffect, useRef, useState } from 'react';
import { kbApi } from '../lib/kbApi';

type MCQData = {
  question: string;
  answers: string[];
};

type TicketData = {
  category: string;
  title: string;
  description: string;
};

type Message = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  mcq?: MCQData;
  ticket?: TicketData;
};

type MCQInteractionState = {
  messageId: string;
  selectedAnswer: string | null;
  customInput: string;
  isCustomMode: boolean;
};

type TicketInteractionState = {
  messageId: string;
  category: string;
  title: string;
  description: string;
  submitted: boolean;
};

const containsHebrew = (text: string | null | undefined): boolean => {
  if (!text) return false;
  return /[\u0590-\u05FF]/.test(text);
};

export const TestAgentPage = () => {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [botThoughts, setBotThoughts] = useState<string | null>(null);
  const [mcqInteractions, setMcqInteractions] = useState<Record<string, MCQInteractionState>>({});
  const [ticketInteractions, setTicketInteractions] = useState<Record<string, TicketInteractionState>>({});
  const [isChatDisabled, setIsChatDisabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentMessageRef = useRef<string>('');

  // Generate unique session ID on mount
  useEffect(() => {
    const generateSessionId = () => {
      const userId = `user_${Math.random().toString(36).substring(2, 9)}`;
      const timestamp = Date.now();
      return `testagent_${userId}_${timestamp}`;
    };
    setSessionId(generateSessionId());
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, mcqInteractions, ticketInteractions]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;
    
    // Check if any MCQ is active (not submitted)
    const hasActiveMcq = Object.values(mcqInteractions).some(m => !m.selectedAnswer || (m.isCustomMode && !m.customInput.trim()));
    if (hasActiveMcq) return;
    
    // Check if chat is disabled (ticket submitted)
    const hasSubmittedTicket = Object.values(ticketInteractions).some(t => t.submitted);
    if (isChatDisabled && !hasSubmittedTicket) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setBotThoughts(null);
    currentMessageRef.current = '';

    try {
      const response = await fetch(`${kbApi.defaults.baseURL}/chat/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
          session_id: sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr || dataStr === '{}') continue;

            try {
              const data = JSON.parse(dataStr);

              // Handle node events (bot thoughts)
              if (data.node) {
                setBotThoughts(data.node);
                continue;
              }

              // Handle text output
              if (data.output_type === 'text' && data.token) {
                currentMessageRef.current += data.token;
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg && lastMsg.role === 'agent' && lastMsg.id === 'current_agent_msg') {
                    return prev.map((msg) =>
                      msg.id === 'current_agent_msg'
                        ? { ...msg, content: currentMessageRef.current }
                        : msg
                    );
                  } else {
                    return [
                      ...prev,
                      {
                        id: 'current_agent_msg',
                        role: 'agent',
                        content: currentMessageRef.current,
                        timestamp: new Date(),
                      },
                    ];
                  }
                });
                continue;
              }

              // Handle MCQ output
              if (data.output_type === 'mcq' && data.question && data.answers) {
                const mcqMessageId = `mcq_${Date.now()}`;
                const mcqMessage: Message = {
                  id: mcqMessageId,
                  role: 'agent',
                  content: '',
                  timestamp: new Date(),
                  mcq: {
                    question: data.question,
                    answers: data.answers,
                  },
                };
                setMessages((prev) => {
                  // Remove current streaming message if exists
                  const filtered = prev.filter((msg) => msg.id !== 'current_agent_msg');
                  return [...filtered, mcqMessage];
                });
                setMcqInteractions((prev) => ({
                  ...prev,
                  [mcqMessageId]: {
                    messageId: mcqMessageId,
                    selectedAnswer: null,
                    customInput: '',
                    isCustomMode: false,
                  },
                }));
                continue;
              }

              // Handle ticket output
              if (data.output_type === 'ticket' && data.category && data.title && data.description) {
                const ticketMessageId = `ticket_${Date.now()}`;
                const ticketMessage: Message = {
                  id: ticketMessageId,
                  role: 'agent',
                  content: '',
                  timestamp: new Date(),
                  ticket: {
                    category: data.category,
                    title: data.title,
                    description: data.description,
                  },
                };
                setMessages((prev) => {
                  // Remove current streaming message if exists
                  const filtered = prev.filter((msg) => msg.id !== 'current_agent_msg');
                  return [...filtered, ticketMessage];
                });
                setTicketInteractions((prev) => ({
                  ...prev,
                  [ticketMessageId]: {
                    messageId: ticketMessageId,
                    category: data.category,
                    title: data.title,
                    description: data.description,
                    submitted: false,
                  },
                }));
                continue;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: 'agent',
          content: 'Error: Failed to send message. Please try again.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setBotThoughts(null);
      currentMessageRef.current = '';
    }
  };

  const handleMcqAnswerSelect = (messageId: string, answer: string) => {
    if (answer === 'write_your_own' || answer === 'Write your own') {
      setMcqInteractions((prev) => ({
        ...prev,
        [messageId]: {
          ...prev[messageId],
          isCustomMode: true,
          selectedAnswer: 'write_your_own',
        },
      }));
    } else {
      setMcqInteractions((prev) => ({
        ...prev,
        [messageId]: {
          ...prev[messageId],
          selectedAnswer: answer,
          isCustomMode: false,
        },
      }));
    }
  };

  const handleMcqSubmit = async (messageId: string) => {
    const mcqInteraction = mcqInteractions[messageId];
    if (!mcqInteraction) return;

    const answer = mcqInteraction.isCustomMode || mcqInteraction.selectedAnswer === 'write_your_own'
      ? mcqInteraction.customInput.trim()
      : mcqInteraction.selectedAnswer;

    if (!answer) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: answer,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setBotThoughts(null);
    currentMessageRef.current = '';

    try {
      const response = await fetch(`${kbApi.defaults.baseURL}/chat/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: answer,
          session_id: sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr || dataStr === '{}') continue;

            try {
              const data = JSON.parse(dataStr);

              if (data.node) {
                setBotThoughts(data.node);
                continue;
              }

              if (data.output_type === 'text' && data.token) {
                currentMessageRef.current += data.token;
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg && lastMsg.role === 'agent' && lastMsg.id === 'current_agent_msg') {
                    return prev.map((msg) =>
                      msg.id === 'current_agent_msg'
                        ? { ...msg, content: currentMessageRef.current }
                        : msg
                    );
                  } else {
                    return [
                      ...prev,
                      {
                        id: 'current_agent_msg',
                        role: 'agent',
                        content: currentMessageRef.current,
                        timestamp: new Date(),
                      },
                    ];
                  }
                });
                continue;
              }

              if (data.output_type === 'mcq' && data.question && data.answers) {
                const mcqMessageId = `mcq_${Date.now()}`;
                const mcqMessage: Message = {
                  id: mcqMessageId,
                  role: 'agent',
                  content: '',
                  timestamp: new Date(),
                  mcq: {
                    question: data.question,
                    answers: data.answers,
                  },
                };
                setMessages((prev) => {
                  const filtered = prev.filter((msg) => msg.id !== 'current_agent_msg');
                  return [...filtered, mcqMessage];
                });
                setMcqInteractions((prev) => ({
                  ...prev,
                  [mcqMessageId]: {
                    messageId: mcqMessageId,
                    selectedAnswer: null,
                    customInput: '',
                    isCustomMode: false,
                  },
                }));
                continue;
              }

              if (data.output_type === 'ticket' && data.category && data.title && data.description) {
                const ticketMessageId = `ticket_${Date.now()}`;
                const ticketMessage: Message = {
                  id: ticketMessageId,
                  role: 'agent',
                  content: '',
                  timestamp: new Date(),
                  ticket: {
                    category: data.category,
                    title: data.title,
                    description: data.description,
                  },
                };
                setMessages((prev) => {
                  const filtered = prev.filter((msg) => msg.id !== 'current_agent_msg');
                  return [...filtered, ticketMessage];
                });
                setTicketInteractions((prev) => ({
                  ...prev,
                  [ticketMessageId]: {
                    messageId: ticketMessageId,
                    category: data.category,
                    title: data.title,
                    description: data.description,
                    submitted: false,
                  },
                }));
                continue;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending MCQ answer:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: 'agent',
          content: 'Error: Failed to send answer. Please try again.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setBotThoughts(null);
      currentMessageRef.current = '';
    }
  };

  const handleTicketSubmit = (messageId: string) => {
    const ticketInteraction = ticketInteractions[messageId];
    if (!ticketInteraction) return;

    setTicketInteractions((prev) => ({
      ...prev,
      [messageId]: {
        ...prev[messageId],
        submitted: true,
      },
    }));
    setIsChatDisabled(true);
  };

  const handleTicketChange = (messageId: string, field: 'category' | 'title' | 'description', value: string) => {
    setTicketInteractions((prev) => ({
      ...prev,
      [messageId]: {
        ...prev[messageId],
        [field]: value,
      },
    }));
    // Also update the message data
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId && msg.ticket
          ? {
              ...msg,
              ticket: {
                ...msg.ticket,
                [field]: value,
              },
            }
          : msg
      )
    );
  };

  const handleTicketModification = async () => {
    const hasSubmittedTicket = Object.values(ticketInteractions).some(t => t.submitted);
    if (!hasSubmittedTicket || !inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setBotThoughts(null);
    currentMessageRef.current = '';

    try {
      const response = await fetch(`${kbApi.defaults.baseURL}/chat/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
          session_id: sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr || dataStr === '{}') continue;

            try {
              const data = JSON.parse(dataStr);

              if (data.node) {
                setBotThoughts(data.node);
                continue;
              }

              if (data.output_type === 'text' && data.token) {
                currentMessageRef.current += data.token;
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg && lastMsg.role === 'agent' && lastMsg.id === 'current_agent_msg') {
                    return prev.map((msg) =>
                      msg.id === 'current_agent_msg'
                        ? { ...msg, content: currentMessageRef.current }
                        : msg
                    );
                  } else {
                    return [
                      ...prev,
                      {
                        id: 'current_agent_msg',
                        role: 'agent',
                        content: currentMessageRef.current,
                        timestamp: new Date(),
                      },
                    ];
                  }
                });
                continue;
              }

              if (data.output_type === 'ticket' && data.category && data.title && data.description) {
                const ticketMessageId = `ticket_${Date.now()}`;
                const ticketMessage: Message = {
                  id: ticketMessageId,
                  role: 'agent',
                  content: '',
                  timestamp: new Date(),
                  ticket: {
                    category: data.category,
                    title: data.title,
                    description: data.description,
                  },
                };
                setMessages((prev) => {
                  const filtered = prev.filter((msg) => msg.id !== 'current_agent_msg');
                  return [...filtered, ticketMessage];
                });
                setTicketInteractions((prev) => ({
                  ...prev,
                  [ticketMessageId]: {
                    messageId: ticketMessageId,
                    category: data.category,
                    title: data.title,
                    description: data.description,
                    submitted: false,
                  },
                }));
                continue;
              }

              if (data.output_type === 'mcq' && data.question && data.answers) {
                const mcqMessageId = `mcq_${Date.now()}`;
                const mcqMessage: Message = {
                  id: mcqMessageId,
                  role: 'agent',
                  content: '',
                  timestamp: new Date(),
                  mcq: {
                    question: data.question,
                    answers: data.answers,
                  },
                };
                setMessages((prev) => {
                  const filtered = prev.filter((msg) => msg.id !== 'current_agent_msg');
                  return [...filtered, mcqMessage];
                });
                setMcqInteractions((prev) => ({
                  ...prev,
                  [mcqMessageId]: {
                    messageId: mcqMessageId,
                    selectedAnswer: null,
                    customInput: '',
                    isCustomMode: false,
                  },
                }));
                continue;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending ticket modification:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: 'agent',
          content: 'Error: Failed to send message. Please try again.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setBotThoughts(null);
      currentMessageRef.current = '';
    }
  };

  return (
    <div dir="rtl" className="flex h-[calc(100vh-12rem)] flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Test Agent</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Session ID: {sessionId || 'Generating...'}
        </p>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-slate-500 dark:text-slate-400">
              Start a conversation with the agent...
            </div>
          )}

          {messages.map((message) => {
            const mcqInteraction = message.mcq ? mcqInteractions[message.id] : null;
            const ticketInteraction = message.ticket ? ticketInteractions[message.id] : null;

            return (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.mcq ? (
                  <div className="max-w-[80%] rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                    <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
                      {message.mcq.question}
                    </h3>
                    {mcqInteraction?.isCustomMode ? (
                      <div className="space-y-3">
                        <textarea
                          value={mcqInteraction.customInput}
                          onChange={(e) =>
                            setMcqInteractions((prev) => ({
                              ...prev,
                              [message.id]: {
                                ...prev[message.id],
                                customInput: e.target.value,
                              },
                            }))
                          }
                          placeholder="Write your own answer..."
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          rows={3}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setMcqInteractions((prev) => ({
                                ...prev,
                                [message.id]: {
                                  ...prev[message.id],
                                  isCustomMode: false,
                                  customInput: '',
                                },
                              }))
                            }
                            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            Back to Options
                          </button>
                          <button
                            onClick={() => handleMcqSubmit(message.id)}
                            disabled={!mcqInteraction.customInput.trim() || isLoading}
                            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                          >
                            Submit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {message.mcq.answers.map((answer, index) => {
                          const isWriteYourOwn = answer === 'Write your own' || answer === 'write_your_own';
                          const isSelected = mcqInteraction?.selectedAnswer === answer || 
                                           (isWriteYourOwn && mcqInteraction?.selectedAnswer === 'write_your_own');
                          return (
                            <button
                              key={index}
                              onClick={() => handleMcqAnswerSelect(message.id, isWriteYourOwn ? 'write_your_own' : answer)}
                              className={`w-full rounded-lg border px-4 py-2 text-left text-sm transition ${
                                isSelected
                                  ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                              }`}
                            >
                              {answer}
                            </button>
                          );
                        })}
                        {!message.mcq.answers.some(a => a === 'Write your own' || a === 'write_your_own') && (
                          <button
                            onClick={() => handleMcqAnswerSelect(message.id, 'write_your_own')}
                            className={`w-full rounded-lg border px-4 py-2 text-left text-sm transition ${
                              mcqInteraction?.selectedAnswer === 'write_your_own'
                                ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            Write your own
                          </button>
                        )}
                        {mcqInteraction?.selectedAnswer && mcqInteraction.selectedAnswer !== 'write_your_own' && (
                          <button
                            onClick={() => handleMcqSubmit(message.id)}
                            disabled={isLoading}
                            className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                          >
                            Submit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : message.ticket ? (
                  <div className="max-w-[80%] space-y-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                      <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Ticket</h3>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Category
                          </label>
                          <input
                            type="text"
                            value={ticketInteraction?.category || message.ticket.category}
                            onChange={(e) => handleTicketChange(message.id, 'category', e.target.value)}
                            disabled={ticketInteraction?.submitted}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Title
                          </label>
                          <input
                            type="text"
                            value={ticketInteraction?.title || message.ticket.title}
                            onChange={(e) => handleTicketChange(message.id, 'title', e.target.value)}
                            disabled={ticketInteraction?.submitted}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Description
                          </label>
                          <textarea
                            value={ticketInteraction?.description || message.ticket.description}
                            onChange={(e) => handleTicketChange(message.id, 'description', e.target.value)}
                            disabled={ticketInteraction?.submitted}
                            rows={4}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                          />
                        </div>
                        {!ticketInteraction?.submitted && (
                          <button
                            onClick={() => handleTicketSubmit(message.id)}
                            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                          >
                            Submit Ticket
                          </button>
                        )}
                        {ticketInteraction?.submitted && (
                          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            Thank you for your patience our team will connect with you soon!
                          </div>
                        )}
                      </div>
                    </div>
                    {ticketInteraction?.submitted && (
                      <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        You can instruct the agent how to change the ticket below (in the text panel - its not disabled)
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {message.content && (
                      <p
                        className={`text-sm whitespace-pre-wrap ${
                          containsHebrew(message.content) ? 'text-right' : ''
                        }`}
                        dir={containsHebrew(message.content) ? 'rtl' : 'auto'}
                      >
                        {message.content}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Bot Thoughts Indicator */}
          {botThoughts && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <p className={containsHebrew(botThoughts) ? 'text-right' : ''} dir={containsHebrew(botThoughts) ? 'rtl' : 'auto'}>
                  {botThoughts}
                </p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (ticketState?.submitted) {
                  handleTicketModification();
                } else {
                  handleSendMessage();
                }
              }
            }}
            placeholder={
              Object.values(ticketInteractions).some(t => t.submitted)
                ? 'Instruct the agent how to change the ticket...'
                : Object.values(mcqInteractions).some(m => !m.selectedAnswer || m.isCustomMode)
                ? 'MCQ is active - select an answer above'
                : 'Type your message...'
            }
            disabled={
              isLoading || 
              (Object.values(mcqInteractions).some(m => !m.selectedAnswer || m.isCustomMode) && 
               !Object.values(ticketInteractions).some(t => t.submitted)) || 
              (isChatDisabled && !Object.values(ticketInteractions).some(t => t.submitted))
            }
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
            rows={2}
          />
          <button
            onClick={Object.values(ticketInteractions).some(t => t.submitted) ? handleTicketModification : handleSendMessage}
            disabled={
              !inputValue.trim() ||
              isLoading ||
              (Object.values(mcqInteractions).some(m => !m.selectedAnswer || m.isCustomMode) && 
               !Object.values(ticketInteractions).some(t => t.submitted)) ||
              (isChatDisabled && !Object.values(ticketInteractions).some(t => t.submitted))
            }
            className="rounded-lg bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

