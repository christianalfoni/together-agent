import express from 'express'
import { createServer as createViteServer } from 'vite'

const app = express()
const PORT = 3000

app.use(express.json())

// API Routes
app.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello World from the API!',
    timestamp: new Date().toISOString(),
  })
})

// Start server
async function startServer() {
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
