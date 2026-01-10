import ReactMarkdown from 'react-markdown'
import { useState } from 'react'

export interface AgentMessage {
  type:
    | 'text'
    | 'discover_tools'
    | 'code_execution_started'
    | 'code_execution_completed'
    | 'custom_tool_call_started'
    | 'custom_tool_call_completed'
    | 'approval_request'
    | 'error'
    | 'done'
  content?: string
  toolName?: string
  callId?: string
  result?: any
  approvalId?: string
  payload?: any
  error?: string
  executionId?: string
  code?: string
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
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700 cursor-pointer text-left font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Code execution completed</span>
                {message.agentMessage.toolCalls && message.agentMessage.toolCalls.length > 0 && (
                  <svg
                    className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>
              {message.agentMessage.code && (
                <button
                  onClick={() => setShowCode(!showCode)}
                  className="p-1 hover:bg-green-50 rounded transition-colors"
                  title="View code"
                >
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            {message.agentMessage.toolCalls && isExpanded && (
              <div className="ml-6 space-y-2 border-l-2 border-green-200 pl-3">
                {message.agentMessage.toolCalls.map((toolCall) => (
                  <div key={toolCall.callId} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{toolCall.toolName}</span>
                    </div>
                    {toolCall.result && (
                      <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto border border-gray-200">
                        {JSON.stringify(toolCall.result, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
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
    (message.agentMessage.type === 'custom_tool_call_started' ||
     message.agentMessage.type === 'custom_tool_call_completed' ||
     message.agentMessage.type === 'code_execution_started' ||
     message.agentMessage.type === 'code_execution_completed')

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
