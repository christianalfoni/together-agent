import { useState } from 'react'

export interface PDFItem {
  id: string
  filename: string
  status: 'generating' | 'completed' | 'error'
  filePath?: string
  size?: number
  error?: string
}

interface PDFListProps {
  pdfs: PDFItem[]
}

export function PDFList({ pdfs }: PDFListProps) {
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())

  if (pdfs.length === 0) {
    return null
  }

  const handleDownload = async (pdf: PDFItem) => {
    if (!pdf.filePath || pdf.status !== 'completed') return

    setDownloadingIds((prev) => new Set(prev).add(pdf.id))

    try {
      const filename = pdf.filePath.split('/').pop() || pdf.filename
      const response = await fetch(`/api/agent/files/${encodeURIComponent(filename)}`)

      if (!response.ok) {
        throw new Error('Failed to download file')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = pdf.filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Download failed:', error)
      alert('Failed to download PDF')
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev)
        next.delete(pdf.id)
        return next
      })
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm text-gray-700 flex-wrap">
      <span className="text-gray-500">PDFs:</span>
      {pdfs.map((pdf) => (
        <div key={pdf.id} className="flex items-center gap-1.5">
          {/* Status Icon */}
          {pdf.status === 'generating' && (
            <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          )}
          {pdf.status === 'completed' && (
            <svg
              className="w-3.5 h-3.5 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
          {pdf.status === 'error' && (
            <svg
              className="w-3.5 h-3.5 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          )}

          {/* PDF Link/Name */}
          {pdf.status === 'completed' && pdf.filePath ? (
            <button
              onClick={() => handleDownload(pdf)}
              disabled={downloadingIds.has(pdf.id)}
              className="text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
              title={downloadingIds.has(pdf.id) ? 'Downloading...' : 'Click to download'}
            >
              {pdf.filename}
            </button>
          ) : (
            <span className={pdf.status === 'error' ? 'text-red-600' : 'text-gray-600'}>
              {pdf.filename}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
