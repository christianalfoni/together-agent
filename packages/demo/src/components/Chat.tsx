import { useState, useRef, useEffect } from 'react'
import { Message, AgentMessage } from './Message'
import { ApprovalDialog, ApprovalRequest } from './ApprovalDialog'
import { PDFList, PDFItem } from './PDFList'
import { useAgentStream } from '../hooks/useAgentStream'

interface ChatMessage {
  id: string
  type: 'user' | 'agent'
  content: string
  agentMessage?: AgentMessage
  timestamp: Date
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [pdfs, setPdfs] = useState<PDFItem[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { sendPrompt, handleApproval, isStreaming, error } = useAgentStream()

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedInput = input.trim()
    if (!trimmedInput || isStreaming || approvalRequest) return

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')

    // Send prompt and handle streaming messages
    await sendPrompt(
      trimmedInput,
      (agentMessage) => {
        // Log all messages to console
        console.log('Received message:', agentMessage.type, agentMessage)

        // Track PDF generation
        if (agentMessage.type === 'custom_tool_call_started' && agentMessage.toolName === 'generatePDF') {
          // Extract filename from payload
          const params = agentMessage.payload
          const filename = params?.filename || 'document.pdf'
          const pdfFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`

          setPdfs((prev) => [
            ...prev,
            {
              id: agentMessage.callId!,
              filename: pdfFilename,
              status: 'generating',
            },
          ])
        }

        if (agentMessage.type === 'custom_tool_call_completed' && agentMessage.toolName === 'generatePDF') {
          setPdfs((prev) =>
            prev.map((pdf) =>
              pdf.id === agentMessage.callId
                ? {
                    ...pdf,
                    status: agentMessage.result?.success ? 'completed' : 'error',
                    filePath: agentMessage.result?.filePath,
                    size: agentMessage.result?.size,
                    error: agentMessage.result?.success ? undefined : agentMessage.result?.message,
                  }
                : pdf
            )
          )
        }

        // Filter out discovery and done messages
        const filteredTypes = [
          'discover_tools',
          'done',
        ]

        if (filteredTypes.includes(agentMessage.type)) {
          return // Skip these internal messages
        }

        // Add or update agent message
        setMessages((prev) => {
          // For text messages, always create a new message
          if (agentMessage.type === 'text') {
            // Skip empty text messages
            if (!agentMessage.content || agentMessage.content.trim() === '') {
              return prev
            }

            // Create a new text message
            return [
              ...prev,
              {
                id: `agent-${Date.now()}-${Math.random()}`,
                type: 'agent' as const,
                content: agentMessage.content || '',
                agentMessage: agentMessage,
                timestamp: new Date(),
              },
            ]
          }

          // For code_execution_started, create a new message with executionId
          if (agentMessage.type === 'code_execution_started') {
            return [
              ...prev,
              {
                id: `execution-${agentMessage.executionId}`,
                type: 'agent' as const,
                content: '',
                agentMessage: {
                  ...agentMessage,
                  toolCalls: [],
                  code: agentMessage.code,
                },
                timestamp: new Date(),
              },
            ]
          }

          // For custom_tool_call_started, add it to the current code execution
          if (agentMessage.type === 'custom_tool_call_started') {
            // Find the most recent code execution message
            const executionIndex = [...prev].reverse().findIndex(
              (msg) => msg.agentMessage?.type === 'code_execution_started'
            )

            if (executionIndex !== -1) {
              const actualIndex = prev.length - 1 - executionIndex
              return prev.map((msg, idx) =>
                idx === actualIndex
                  ? {
                      ...msg,
                      agentMessage: {
                        ...msg.agentMessage!,
                        toolCalls: [
                          ...(msg.agentMessage!.toolCalls || []),
                          {
                            callId: agentMessage.callId!,
                            toolName: agentMessage.toolName!,
                            status: 'running' as const,
                          },
                        ],
                      },
                    }
                  : msg
              )
            }

            // Fallback: no code execution found, show as standalone
            return [
              ...prev,
              {
                id: `tool-${agentMessage.callId}`,
                type: 'agent' as const,
                content: agentMessage.toolName || '',
                agentMessage: agentMessage,
                timestamp: new Date(),
              },
            ]
          }

          // For custom_tool_call_completed, update the tool call within code execution
          if (agentMessage.type === 'custom_tool_call_completed') {
            // Find the most recent code execution message
            const executionIndex = [...prev].reverse().findIndex(
              (msg) => msg.agentMessage?.type === 'code_execution_started'
            )

            if (executionIndex !== -1) {
              const actualIndex = prev.length - 1 - executionIndex
              return prev.map((msg, idx) =>
                idx === actualIndex
                  ? {
                      ...msg,
                      agentMessage: {
                        ...msg.agentMessage!,
                        toolCalls: msg.agentMessage!.toolCalls?.map((tc) =>
                          tc.callId === agentMessage.callId
                            ? {
                                ...tc,
                                status: 'completed' as const,
                                result: agentMessage.result,
                              }
                            : tc
                        ),
                      },
                    }
                  : msg
              )
            }

            // Fallback: update standalone tool message
            return prev.map((msg) =>
              msg.id === `tool-${agentMessage.callId}`
                ? {
                    ...msg,
                    agentMessage: agentMessage,
                  }
                : msg
            )
          }

          // For code_execution_completed, update the code execution message
          if (agentMessage.type === 'code_execution_completed') {
            return prev.map((msg) =>
              msg.id === `execution-${agentMessage.executionId}`
                ? {
                    ...msg,
                    agentMessage: {
                      ...msg.agentMessage!,
                      type: 'code_execution_completed',
                      code: msg.agentMessage!.code || agentMessage.code,
                    },
                  }
                : msg
            )
          }

          // For all other message types, create new message
          return [
            ...prev,
            {
              id: `agent-${Date.now()}-${Math.random()}`,
              type: 'agent' as const,
              content: agentMessage.content || '',
              agentMessage: agentMessage,
              timestamp: new Date(),
            },
          ]
        })
      },
      (request) => {
        // Handle approval request
        setApprovalRequest(request)
      }
    )
  }

  const handleApprove = async (approvalId: string) => {
    await handleApproval(approvalId, true)
    setApprovalRequest(null)
  }

  const handleReject = async (approvalId: string) => {
    await handleApproval(approvalId, false)
    setApprovalRequest(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage(e)
    }
  }

  const isInputDisabled = isStreaming || !!approvalRequest

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-lg font-semibold mb-2">Welcome to Gmail Agent</p>
            <p className="text-sm">Try asking me to:</p>
            <ul className="text-sm mt-2 space-y-1">
              <li>&quot;Show me my unread emails&quot;</li>
              <li>&quot;Send an email to example@gmail.com&quot;</li>
              <li>&quot;What emails did I get from John?&quot;</li>
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            <span>Agent is thinking...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 p-4 bg-white">
        {pdfs.length > 0 && (
          <div className="mb-3">
            <PDFList pdfs={pdfs} />
          </div>
        )}
        <form onSubmit={handleSendMessage} className="flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              approvalRequest
                ? 'Waiting for approval...'
                : isStreaming
                ? 'Agent is responding...'
                : 'Type your message... (Shift+Enter for new line)'
            }
            disabled={isInputDisabled}
            className="flex-1 resize-none border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            rows={3}
          />
          <button
            type="submit"
            disabled={isInputDisabled || !input.trim()}
            className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </form>
      </div>

      {/* Approval Dialog */}
      {approvalRequest && (
        <ApprovalDialog
          request={approvalRequest}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  )
}
