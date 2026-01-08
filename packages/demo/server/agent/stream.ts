import { Router } from 'express'
import type { Request } from 'express'

export const agentRouter = Router()

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
