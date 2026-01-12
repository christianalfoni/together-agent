import { useState, useCallback, useRef } from 'react'
import type { AgentMessage } from '../components/Message'
import type { ApprovalRequest } from '../components/ApprovalDialog'

export function useAgentStream() {
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const sendPrompt = useCallback(
    async (
      prompt: string,
      onMessage: (message: AgentMessage) => void,
      onApprovalRequest: (request: ApprovalRequest) => void
    ) => {
      setIsStreaming(true)
      setError(null)

      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      try {
        // Use XMLHttpRequest to send POST and receive SSE stream
        const xhr = new XMLHttpRequest()

        xhr.open('POST', '/api/agent/prompt', true)
        xhr.setRequestHeader('Content-Type', 'application/json')

        let buffer = ''
        let processedLength = 0

        xhr.onprogress = () => {
          // Get only the new data we haven't processed yet
          const newData = xhr.responseText.substring(processedLength)
          processedLength = xhr.responseText.length

          // Append new data to buffer
          buffer += newData

          // Split by double newline (SSE message separator)
          const parts = buffer.split('\n\n')

          // Keep the last incomplete part in the buffer
          buffer = parts.pop() || ''

          // Process complete messages
          for (const part of parts) {
            const lines = part.split('\n')
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const message: AgentMessage = JSON.parse(line.substring(6))

                  // Handle approval requests separately
                  if (message.type === 'approval_request') {
                    console.log('🚨 APPROVAL REQUEST RECEIVED:', message)
                    onApprovalRequest({
                      approvalId: message.approvalId!,
                      payload: message.payload!,
                    })
                  } else if (message.type === 'done') {
                    // Stream is complete
                    setIsStreaming(false)
                  } else {
                    // Regular message
                    onMessage(message)
                  }
                } catch (err) {
                  console.error('Failed to parse message:', err, 'Line:', line)
                }
              }
            }
          }
        }

        xhr.onload = () => {
          setIsStreaming(false)
        }

        xhr.onerror = () => {
          console.error('Request error')
          setError('Connection lost. Please try again.')
          setIsStreaming(false)
        }

        xhr.send(JSON.stringify({ prompt }))

        // Store reference for cancellation
        abortControllerRef.current = {
          abort: () => xhr.abort()
        } as any

      } catch (err: any) {
        console.error('Failed to send prompt:', err)
        setError(err.message || 'Failed to send prompt. Please try again.')
        setIsStreaming(false)
      }
    },
    []
  )

  const handleApproval = useCallback(async (approvalId: string, approved: boolean) => {
    console.log(`✅ SENDING APPROVAL RESPONSE: ${approved ? 'APPROVED' : 'REJECTED'}`, approvalId)
    try {
      const response = await fetch('/api/agent/approval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approvalId, approved }),
      })

      if (!response.ok) {
        throw new Error(`Failed to ${approved ? 'approve' : 'reject'} action`)
      }
      console.log(`✅ APPROVAL RESPONSE SENT SUCCESSFULLY`)
    } catch (err: any) {
      console.error('Failed to handle approval:', err)
      throw err
    }
  }, [])

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsStreaming(false)
  }, [])

  return {
    sendPrompt,
    handleApproval,
    cancel,
    isStreaming,
    error,
  }
}
