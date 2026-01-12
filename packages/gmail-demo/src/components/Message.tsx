import ReactMarkdown from 'react-markdown'
import { useState } from 'react'

export interface AgentMessage {
  type:
    | 'text'
    | 'execute_code_tools_discovery'
    | 'code_execution_started'
    | 'code_execution_completed'
    | 'custom_tool_call_started'
    | 'custom_tool_call_completed'
    | 'approval_request'
    | 'journal_entry_created'
    | 'journal_entries_read'
    | 'journal_entries_compressed'
    | 'error'
    | 'done'
    | 'debug'
  content?: string
  toolName?: string
  callId?: string
  result?: any
  approvalId?: string
  args?: any
  payload?: any
  error?: string
  executionId?: string
  code?: string
  entryIndex?: number
  title?: string
  entryIndices?: number[]
  compressedEntries?: Array<{ index: number; title: string }>
  terms?: string
  matchedTools?: string[]
  contextSize?: number
  cumulativeInput?: number
  cumulativeOutput?: number
  messages?: Array<{
    role: string
    content: any
  }>
  messageCount?: number
  toolCalls?: Array<{
    callId: string
    toolName: string
    status: 'running' | 'completed'
    result?: any
  }>
}

export interface MessageProps {
  message: {
    type: 'user' | 'agent'
    content: string
    agentMessage?: AgentMessage
    timestamp?: Date
  }
}

export function Message({ message }: MessageProps) {
  const isUser = message.type === 'user'
  const [isExpanded, setIsExpanded] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())

  const renderAgentMessage = () => {
    if (!message.agentMessage) {
      return (
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="text-gray-800 mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc list-inside text-gray-800 space-y-1 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside text-gray-800 space-y-1 mb-2">{children}</ol>,
              li: ({ children }) => <li className="text-gray-800">{children}</li>,
              code: ({ children, ...props }) => {
                const isInline = !props.className
                return isInline ? (
                  <code className="bg-gray-200 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">
                    {children}
                  </code>
                ) : (
                  <code className="block bg-gray-200 text-gray-800 p-3 rounded text-sm font-mono overflow-x-auto mb-2">
                    {children}
                  </code>
                )
              },
              strong: ({ children }) => <strong className="font-bold text-gray-900">{children}</strong>,
              em: ({ children }) => <em className="italic text-gray-800">{children}</em>,
              a: ({ href, children }) => (
                <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      )
    }

    const { type, toolName, result, error } = message.agentMessage

    switch (type) {
      case 'text':
        return (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="text-gray-800 mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside text-gray-800 space-y-1 mb-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside text-gray-800 space-y-1 mb-2">{children}</ol>,
                li: ({ children }) => <li className="text-gray-800">{children}</li>,
                code: ({ children, ...props }) => {
                  const isInline = !props.className
                  return isInline ? (
                    <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">
                      {children}
                    </code>
                  ) : (
                    <code className="block bg-gray-100 text-gray-800 p-3 rounded text-sm font-mono overflow-x-auto mb-2">
                      {children}
                    </code>
                  )
                },
                strong: ({ children }) => <strong className="font-bold text-gray-900">{children}</strong>,
                em: ({ children }) => <em className="italic text-gray-800">{children}</em>,
                a: ({ href, children }) => (
                  <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )

      case 'execute_code_tools_discovery':
        return (
          <div className="space-y-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 cursor-pointer w-full text-left"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Discovered {message.agentMessage.matchedTools?.length || 0} code tool(s) for execute_code: &quot;{message.agentMessage.terms}&quot;</span>
              {message.agentMessage.matchedTools && message.agentMessage.matchedTools.length > 0 && (
                <svg
                  className={`w-4 h-4 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </button>
            {isExpanded && message.agentMessage.matchedTools && message.agentMessage.matchedTools.length > 0 && (
              <div className="ml-6 space-y-1 border-l-2 border-blue-200 pl-3">
                {message.agentMessage.matchedTools.map((toolName) => (
                  <div key={toolName} className="flex items-center gap-2 text-sm text-gray-700">
                    <svg className="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-mono">{toolName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'code_execution_started':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-purple-600 font-medium">
              <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
              <span>Code execution started</span>
              {message.agentMessage.code && (
                <button
                  onClick={() => setShowCode(!showCode)}
                  className="ml-2 p-1 hover:bg-purple-50 rounded transition-colors"
                  title="View code"
                >
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </button>
              )}
            </div>
            {showCode && message.agentMessage.code && (
              <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto border border-gray-700">
                <code>{message.agentMessage.code}</code>
              </pre>
            )}
            {message.agentMessage.toolCalls && message.agentMessage.toolCalls.length > 0 && (
              <div className="ml-6 space-y-1 border-l-2 border-purple-200 pl-3">
                {message.agentMessage.toolCalls.map((toolCall) => (
                  <div key={toolCall.callId} className="flex items-center gap-2 text-sm">
                    {toolCall.status === 'running' ? (
                      <>
                        <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-indigo-600">Running {toolCall.toolName}...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-green-600">{toolCall.toolName} completed</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'code_execution_completed':
        const hasError = !!message.agentMessage.error
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={`flex items-center gap-2 text-sm cursor-pointer text-left font-medium ${
                  hasError
                    ? 'text-red-600 hover:text-red-700'
                    : 'text-green-600 hover:text-green-700'
                }`}
              >
                {hasError ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span>Code execution {hasError ? 'failed' : 'completed'}</span>
                <svg
                  className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {message.agentMessage.code && (
                <button
                  onClick={() => setShowCode(!showCode)}
                  className={`p-1 rounded transition-colors ${
                    hasError
                      ? 'hover:bg-red-50'
                      : 'hover:bg-green-50'
                  }`}
                  title="View code"
                >
                  <svg className={`w-4 h-4 ${hasError ? 'text-red-600' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </button>
              )}
            </div>
            {showCode && message.agentMessage.code && (
              <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto border border-gray-700">
                <code>{message.agentMessage.code}</code>
              </pre>
            )}
            {isExpanded && (
              <div className={`ml-6 space-y-2 border-l-2 pl-3 ${
                hasError ? 'border-red-200' : 'border-green-200'
              }`}>
                {/* Show error if present */}
                {hasError && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-red-600">Error:</div>
                    <div className="text-xs bg-red-50 text-red-800 p-2 rounded border border-red-200">
                      {message.agentMessage.error}
                    </div>
                  </div>
                )}
                {/* Show the result */}
                {message.agentMessage.result && !hasError && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-gray-600">Result:</div>
                    <div className="text-xs bg-gray-50 p-2 rounded border border-gray-200 prose prose-sm max-w-none">
                      <ReactMarkdown>{message.agentMessage.result}</ReactMarkdown>
                    </div>
                  </div>
                )}
                {/* Show tool calls */}
                {message.agentMessage.toolCalls && message.agentMessage.toolCalls.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-600">Tool Calls:</div>
                    {message.agentMessage.toolCalls.map((toolCall) => {
                      const isToolExpanded = expandedToolCalls.has(toolCall.callId)
                      return (
                        <div key={toolCall.callId} className="space-y-1">
                          <button
                            onClick={() => {
                              const newExpanded = new Set(expandedToolCalls)
                              if (isToolExpanded) {
                                newExpanded.delete(toolCall.callId)
                              } else {
                                newExpanded.add(toolCall.callId)
                              }
                              setExpandedToolCalls(newExpanded)
                            }}
                            className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700 w-full text-left"
                          >
                            <svg
                              className={`w-3 h-3 transition-transform ${isToolExpanded ? 'rotate-90' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>{toolCall.toolName}</span>
                          </button>
                          {isToolExpanded && toolCall.result && (
                            <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto border border-gray-200 ml-5">
                              {JSON.stringify(toolCall.result, null, 2)}
                            </pre>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )

      case 'custom_tool_call_started':
        return (
          <div className="flex items-center gap-2 text-sm text-indigo-600">
            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span>Running {toolName}...</span>
          </div>
        )

      case 'custom_tool_call_completed':
        return (
          <div className="space-y-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700 cursor-pointer w-full text-left"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{toolName} completed</span>
              {result && (
                <svg
                  className={`w-4 h-4 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </button>
            {result && isExpanded && (
              <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto border border-gray-200">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )

      case 'journal_entry_created':
        return (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span>Journal entry created: &quot;{message.agentMessage.title}&quot;</span>
          </div>
        )

      case 'journal_entries_read':
        return (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span>Read journal entries: {message.agentMessage.entryIndices?.join(', ')}</span>
          </div>
        )

      case 'journal_entries_compressed':
        return (
          <div className="space-y-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-700 cursor-pointer w-full text-left"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>Journal entries compressed ({message.agentMessage.compressedEntries?.length || 0} entries)</span>
              <svg
                className={`w-4 h-4 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isExpanded && message.agentMessage.compressedEntries && (
              <div className="ml-6 space-y-1 text-xs text-gray-500">
                {message.agentMessage.compressedEntries.map((entry) => (
                  <div key={entry.index}>
                    • Entry {entry.index}: &quot;{entry.title}&quot;
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'error':
        return (
          <div className="flex items-start gap-2 text-sm text-red-600">
            <svg className="w-4 h-4 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error || message.content}</span>
          </div>
        )

      default:
        return <p className="text-gray-800 whitespace-pre-wrap">{message.content}</p>
    }
  }

  // Check if this is a tool message (not text, no bubble)
  const isToolMessage = !isUser && message.agentMessage &&
    (message.agentMessage.type === 'execute_code_tools_discovery' ||
     message.agentMessage.type === 'custom_tool_call_started' ||
     message.agentMessage.type === 'custom_tool_call_completed' ||
     message.agentMessage.type === 'code_execution_started' ||
     message.agentMessage.type === 'code_execution_completed' ||
     message.agentMessage.type === 'journal_entry_created' ||
     message.agentMessage.type === 'journal_entries_read' ||
     message.agentMessage.type === 'journal_entries_compressed')

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {isToolMessage ? (
        // Tool messages without bubble
        <div className="max-w-[80%]">
          {renderAgentMessage()}
        </div>
      ) : (
        // Regular messages with bubble
        <div
          className={`max-w-[80%] rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            renderAgentMessage()
          )}
          {message.timestamp && (
            <p className={`text-xs mt-2 ${isUser ? 'text-indigo-200' : 'text-gray-500'}`}>
              {message.timestamp.toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
