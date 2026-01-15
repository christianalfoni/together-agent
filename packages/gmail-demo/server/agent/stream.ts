import { Router } from 'express'
import type { Request } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import multer from 'multer'

export const agentRouter = Router()

// Configure multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10, // Max 10 files per upload
  },
})

// Type guard for authenticated requests
interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    name: string
    picture?: string
    accessToken: string
  }
  isAuthenticated(): boolean
}

// Middleware to check authentication
function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized - Please sign in' })
  }

  if (!req.user || !req.user.accessToken) {
    return res.status(401).json({ error: 'No Google access token found - Please sign in again' })
  }

  next()
}

// Initialize agent (called on server startup)
let agentUrl: string | null = null
let agentInstance: any = null

export async function initializeAgent() {
  const { TogetherAgentSDK } = await import('together-agent')

  const apiKey = process.env.TOGETHER_API_KEY
  const templateId = process.env.AGENT_TEMPLATE_ID

  if (!apiKey) {
    console.warn('⚠️  TOGETHER_API_KEY not set - agent functionality will not work')
    return null
  }

  if (!templateId) {
    console.warn('⚠️  AGENT_TEMPLATE_ID not set - agent functionality will not work')
    return null
  }

  try {
    console.log('🤖 Creating agent from template:', templateId)
    const sdk = new TogetherAgentSDK({ apiKey })
    const agent = await sdk.createAgent(templateId)
    agentUrl = agent.url
    agentInstance = agent // Store the agent instance for uploadFile()
    console.log('✅ Agent created successfully')
    console.log('   Agent URL:', agentUrl)
    console.log('   Approval URL will be:', (agentUrl.endsWith('/') ? agentUrl : agentUrl + '/') + 'approval')
    return agent
  } catch (error) {
    console.error('❌ Failed to create agent:', error)
    return null
  }
}

// POST /api/agent/prompt - Stream agent responses via SSE
agentRouter.post('/prompt', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { prompt } = req.body

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required and must be a string' })
  }

  if (!agentUrl) {
    return res.status(503).json({ error: 'Agent is not initialized. Please check server logs.' })
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    // Get access token from user object (set by Passport)
    const googleAccessToken = req.user?.accessToken

    // Make request to agent
    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        apiKey: process.env.TOGETHER_API_KEY,
        secrets: {
          GOOGLE_ACCESS_TOKEN: googleAccessToken,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Agent responded with status ${response.status}`)
    }

    if (!response.body) {
      throw new Error('No response body from agent')
    }

    // Stream the response to the client
    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      const chunk = decoder.decode(value, { stream: true })
      res.write(chunk)
    }

    res.end()
  } catch (error: any) {
    console.error('Stream error:', error)
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
    res.end()
  }
})

// POST /api/agent/approval - Handle approval requests
agentRouter.post('/approval', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { approvalId, approved } = req.body

  if (!approvalId || typeof approvalId !== 'string') {
    return res.status(400).json({ error: 'approvalId is required and must be a string' })
  }

  if (typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'approved must be a boolean' })
  }

  if (!agentUrl) {
    return res.status(503).json({ error: 'Agent is not initialized' })
  }

  try {
    // Forward approval to agent (append 'approval' to base URL)
    const baseUrl = agentUrl.endsWith('/') ? agentUrl : agentUrl + '/'
    const approvalUrl = baseUrl + 'approval'
    console.log('Forwarding approval to:', approvalUrl)
    const response = await fetch(approvalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        approvalId,
        approved,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Agent approval failed: ${text}`)
    }

    res.json({ success: true })
  } catch (error: any) {
    console.error('Approval error:', error)
    res.status(500).json({ error: error.message || 'Failed to handle approval' })
  }
})

// POST /api/agent/files - Upload files to agent workspace
agentRouter.post('/files', requireAuth, upload.array('files', 10), async (req: AuthenticatedRequest, res) => {
  if (!agentInstance) {
    return res.status(503).json({ error: 'Agent is not initialized' })
  }

  const files = req.files as Express.Multer.File[]

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' })
  }

  try {
    const uploadResults = []

    for (const file of files) {
      // Generate unique filename to avoid collisions
      const timestamp = Date.now()
      const filename = `${timestamp}_${file.originalname}`

      console.log(`Uploading file: ${filename} (${file.size} bytes)`)

      // Upload to agent workspace
      const uploadResponse = await agentInstance.uploadFile(
        filename,
        file.buffer,
        file.mimetype
      )

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload ${file.originalname}: ${uploadResponse.statusText}`)
      }

      const result = await uploadResponse.json()

      uploadResults.push({
        originalName: file.originalname,
        path: result.path || filename,
        size: file.size,
        mimetype: file.mimetype,
      })
    }

    console.log(`✅ Successfully uploaded ${uploadResults.length} file(s)`)

    res.json({
      success: true,
      files: uploadResults,
    })
  } catch (error: any) {
    console.error('File upload error:', error)
    res.status(500).json({
      error: error.message || 'Failed to upload files',
      success: false,
    })
  }
})

// POST /api/agent/code-tool - Proxy code tool execution to agent
agentRouter.post('/code-tool', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { toolName, args, approvalToken } = req.body

  if (!toolName || typeof toolName !== 'string') {
    return res.status(400).json({ error: 'toolName is required and must be a string' })
  }

  if (!agentUrl) {
    return res.status(503).json({ error: 'Agent is not initialized' })
  }

  try {
    // Get access token from user object
    const googleAccessToken = req.user?.accessToken

    // Construct the code-tool endpoint URL
    const baseUrl = agentUrl.replace(/\/prompt\/?$/, '')
    const codeToolUrl = `${baseUrl}/code-tool`
    console.log('Proxying code tool request to:', codeToolUrl)

    // Forward request to agent's /code-tool endpoint
    const response = await fetch(codeToolUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName,
        args,
        secrets: {
          GOOGLE_ACCESS_TOKEN: googleAccessToken,
        },
        approvalToken,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Agent code-tool request failed: ${text}`)
    }

    const result = await response.json()
    res.json(result)
  } catch (error: any) {
    console.error('Code tool proxy error:', error)
    res.status(500).json({ error: error.message || 'Failed to execute code tool' })
  }
})

// GET /api/agent/files/* - Download files from agent workspace
agentRouter.get('/files/*filepath', requireAuth, async (req: AuthenticatedRequest, res) => {
  // Get the full file path from the wildcard (it comes as an array)
  const filePath = Array.isArray(req.params.filepath)
    ? req.params.filepath.join('/')
    : req.params.filepath

  if (!filePath) {
    return res.status(400).json({ error: 'File path is required' })
  }

  if (!agentUrl) {
    return res.status(503).json({ error: 'Agent is not initialized' })
  }

  try {
    // Construct the agent's base URL (remove /prompt suffix if present)
    const baseUrl = agentUrl.replace(/\/prompt\/?$/, '')

    // Forward the file request to the agent
    const fileUrl = `${baseUrl}/files/${encodeURIComponent(filePath)}`
    console.log('Proxying file download to:', fileUrl)

    const response = await fetch(fileUrl)

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Agent file download failed: ${text}`)
    }

    // Forward relevant headers from the agent response
    const contentType = response.headers.get('content-type')
    const contentLength = response.headers.get('content-length')
    const contentDisposition = response.headers.get('content-disposition')

    if (contentType) res.setHeader('Content-Type', contentType)
    if (contentLength) res.setHeader('Content-Length', contentLength)
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition)

    // Stream the file from the agent to the client
    if (!response.body) {
      throw new Error('No response body from agent')
    }

    // Use the Web Streams API to pipe the response
    const reader = response.body.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
    } catch (streamError) {
      console.error('Stream error:', streamError)
      throw streamError
    }
  } catch (error: any) {
    console.error('File download proxy error:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to download file' })
    }
  }
})
