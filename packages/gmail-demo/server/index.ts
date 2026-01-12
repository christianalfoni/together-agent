import 'dotenv/config'
import express from 'express'
import { createServer as createViteServer } from 'vite'
import session from 'express-session'
import passport from 'passport'
import authRouter, { configureGoogleAuth } from './auth/google.js'
import { agentRouter, initializeAgent } from './agent/stream.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

// Configure session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'demo-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
)

// Initialize Passport
app.use(passport.initialize())
app.use(passport.session())

// Configure Google OAuth
configureGoogleAuth()

// Auth routes
app.use('/auth', authRouter)

// Agent routes
app.use('/api/agent', agentRouter)

// API Routes
app.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello World from the API!',
    timestamp: new Date().toISOString(),
  })
})

// Start server
async function startServer() {
  // Initialize agent
  await initializeAgent()

  if (process.env.NODE_ENV !== 'production') {
    // In development, use Vite dev server
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    })

    app.use(vite.middlewares)
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`)
  })
}

startServer()
