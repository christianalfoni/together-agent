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

interface AttachedFile {
  id: string
  name: string
  path: string
  size: number
  status: 'uploading' | 'uploaded' | 'error'
  error?: string
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [pdfs, setPdfs] = useState<PDFItem[]>([])
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [tokenUsage, setTokenUsage] = useState<{
    contextSize?: number;
    tokensUsed?: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }>({ totalInputTokens: 0, totalOutputTokens: 0 })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { sendPrompt, handleApproval, isStreaming, error } = useAgentStream()

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    // Create file entries with uploading status
    const newFiles: AttachedFile[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      name: file.name,
      path: '', // Will be set after upload
      size: file.size,
      status: 'uploading',
    }))

    setAttachedFiles((prev) => [...prev, ...newFiles])

    // Upload files
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))

    try {
      const response = await fetch('/api/agent/files', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      const result = await response.json()

      // Update file statuses
      setAttachedFiles((prev) =>
        prev.map((file, idx) => {
          const uploadedFile = result.files[idx]
          if (uploadedFile && file.status === 'uploading') {
            return {
              ...file,
              path: uploadedFile.path,
              status: 'uploaded',
            }
          }
          return file
        })
      )
    } catch (error) {
      console.error('File upload error:', error)
      // Mark all uploading files as error
      setAttachedFiles((prev) =>
        prev.map((file) =>
          file.status === 'uploading'
            ? { ...file, status: 'error', error: 'Upload failed' }
            : file
        )
      )
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles((prev) => prev.filter((file) => file.id !== fileId))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedInput = input.trim()
    if (!trimmedInput || isStreaming || approvalRequest) return

    // Build prompt with attachments
    let prompt = trimmedInput
    const uploadedFiles = attachedFiles.filter((f) => f.status === 'uploaded')
    if (uploadedFiles.length > 0) {
      const filePaths = uploadedFiles.map((f) => f.path).join(', ')
      prompt = `${trimmedInput}\n\nAttachments added: ${filePaths}`
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setAttachedFiles([]) // Clear attachments after sending

    // Send prompt and handle streaming messages
    await sendPrompt(
      prompt,
      (agentMessage) => {
        // Log all messages to console
        console.log('Received message:', agentMessage.type, agentMessage)

        // Track PDF generation
        if (agentMessage.type === 'custom_tool_call_started' && agentMessage.toolName === 'generatePDF') {
          // Extract filename from args
          const params = agentMessage.args
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

        // Handle done message for token usage stats
        if (agentMessage.type === 'done') {
          setTokenUsage((prev) => ({
            contextSize: agentMessage.contextSize,
            tokensUsed: agentMessage.tokensUsed,
            totalInputTokens: prev.totalInputTokens + (agentMessage.contextSize || 0),
            totalOutputTokens: prev.totalOutputTokens + (agentMessage.tokensUsed || 0),
          }))
          return // Don't add as message
        }

        // Handle debug message - just log to console, don't display
        if (agentMessage.type === 'debug') {
          console.log('=== DEBUG: Messages sent to LLM ===')
          console.log('Message count:', agentMessage.messageCount)
          console.log('Messages:', agentMessage.messages)
          console.log('===================================')
          return // Don't add as message
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
                id: `execution-${agentMessage.executionId || `${Date.now()}-${Math.random()}`}`,
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
                      result: agentMessage.result,
                      error: agentMessage.error,
                    },
                  }
                : msg
            )
          }

          // For execute_code_tools_discovery, add as new message
          if (agentMessage.type === 'execute_code_tools_discovery') {
            return [
              ...prev,
              {
                id: `execute-code-tools-discovery-${Date.now()}`,
                type: 'agent' as const,
                content: '',
                agentMessage: agentMessage,
                timestamp: new Date(),
              },
            ]
          }

          // For journal_entry_created, add as new message
          if (agentMessage.type === 'journal_entry_created') {
            return [
              ...prev,
              {
                id: `journal-created-${agentMessage.entryIndex}`,
                type: 'agent' as const,
                content: '',
                agentMessage: agentMessage,
                timestamp: new Date(),
              },
            ]
          }

          // For journal_entries_read, add as new message
          if (agentMessage.type === 'journal_entries_read') {
            return [
              ...prev,
              {
                id: `journal-read-${Date.now()}`,
                type: 'agent' as const,
                content: '',
                agentMessage: agentMessage,
                timestamp: new Date(),
              },
            ]
          }

          // For journal_entries_compressed, add as new message
          if (agentMessage.type === 'journal_entries_compressed') {
            return [
              ...prev,
              {
                id: `journal-compressed-${Date.now()}`,
                type: 'agent' as const,
                content: '',
                agentMessage: agentMessage,
                timestamp: new Date(),
              },
            ]
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
      {/* Token usage stats bar */}
      {tokenUsage && (tokenUsage.totalInputTokens > 0 || tokenUsage.totalOutputTokens > 0) && (
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-6">
            {/* Total tokens */}
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Total Tokens:</span>
              <span className="font-mono font-semibold text-gray-800">
                {(tokenUsage.totalInputTokens + tokenUsage.totalOutputTokens).toLocaleString()}
              </span>
              <span className="text-gray-400">
                ({tokenUsage.totalInputTokens.toLocaleString()} in / {tokenUsage.totalOutputTokens.toLocaleString()} out)
              </span>
            </div>

            {/* Divider */}
            <div className="h-4 w-px bg-gray-300" />

            {/* Last turn stats */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Last Context:</span>
                <span className={`font-mono font-semibold ${
                  (tokenUsage.contextSize || 0) > 50000
                    ? 'text-red-600'
                    : (tokenUsage.contextSize || 0) > 40000
                    ? 'text-orange-600'
                    : 'text-gray-800'
                }`}>
                  {tokenUsage.contextSize?.toLocaleString() || 0}
                </span>
                {(tokenUsage.contextSize || 0) > 50000 && (
                  <span className="text-red-600 text-xs">(compressed)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Last Response:</span>
                <span className="font-mono font-semibold text-gray-800">
                  {tokenUsage.tokensUsed?.toLocaleString() || 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
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

        {/* Attached files display */}
        {attachedFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachedFiles.map((file) => (
              <div
                key={file.id}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  file.status === 'uploaded'
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : file.status === 'uploading'
                    ? 'bg-gray-50 text-gray-600 border border-gray-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {file.status === 'uploading' && (
                  <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                )}
                {file.status === 'uploaded' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {file.status === 'error' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <span className="font-medium">{file.name}</span>
                <span className="text-xs opacity-75">({formatFileSize(file.size)})</span>
                {file.status !== 'uploading' && (
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(file.id)}
                    className="ml-1 hover:opacity-70"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSendMessage} className="flex gap-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="flex-1 flex flex-col gap-2">
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
              className="resize-none border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isInputDisabled}
              className="p-3 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              title="Attach files"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>

            <button
              type="submit"
              disabled={isInputDisabled || !input.trim()}
              className="p-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
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
          </div>
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
