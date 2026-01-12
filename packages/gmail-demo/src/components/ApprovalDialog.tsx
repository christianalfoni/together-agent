import { useState } from 'react'

export interface ApprovalRequest {
  approvalId: string
  payload: {
    action: string
    to?: string
    subject?: string
    body?: string
    warning?: string
    [key: string]: any
  }
}

interface ApprovalDialogProps {
  request: ApprovalRequest
  onApprove: (approvalId: string) => Promise<void>
  onReject: (approvalId: string) => Promise<void>
}

export function ApprovalDialog({ request, onApprove, onReject }: ApprovalDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    console.log('🟢 APPROVE BUTTON CLICKED', request.approvalId)
    setLoading(true)
    setError(null)
    try {
      await onApprove(request.approvalId)
    } catch (err) {
      setError('Failed to approve action. Please try again.')
      setLoading(false)
    }
  }

  const handleReject = async () => {
    console.log('🔴 REJECT BUTTON CLICKED', request.approvalId)
    setLoading(true)
    setError(null)
    try {
      await onReject(request.approvalId)
    } catch (err) {
      setError('Failed to reject action. Please try again.')
      setLoading(false)
    }
  }

  const { payload } = request

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-800 mb-1">Approval Required</h2>
            <p className="text-sm text-gray-600">
              The agent needs your permission to perform this action
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Action</p>
            <p className="text-gray-900">{payload.action}</p>
          </div>

          {payload.to && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">To</p>
              <p className="text-gray-900">{payload.to}</p>
            </div>
          )}

          {payload.subject && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Subject</p>
              <p className="text-gray-900">{payload.subject}</p>
            </div>
          )}

          {payload.body && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Message</p>
              <p className="text-gray-900 whitespace-pre-wrap">{payload.body}</p>
            </div>
          )}

          {payload.warning && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-3">
              <p className="text-sm text-yellow-800">
                <span className="font-semibold">Warning:</span> {payload.warning}
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleReject}
            disabled={loading}
            className="flex-1 px-4 py-2.5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
          >
            Reject
          </button>
          <button
            onClick={handleApprove}
            disabled={loading}
            className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
          >
            {loading ? 'Processing...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}
