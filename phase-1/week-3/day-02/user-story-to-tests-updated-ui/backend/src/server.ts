import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from root directory BEFORE importing anything that reads them
const envPath = path.join(__dirname, '../../.env')
console.log(`Loading .env from: ${envPath}`)
dotenv.config({ path: envPath })

import { generateRouter } from './routes/generate'
import { configRouter } from './routes/config'
import { jiraRouter } from './routes/jira'
import { authRouter, isAuthConfigured, requireAuth } from './auth'
import { getEnabledProviders, listModels } from './llm/providers'
import { isJiraEnabled } from './jira/jiraClient'

const providers = getEnabledProviders()
console.log(`PORT: ${process.env.PORT}`)
console.log(`CORS_ORIGIN: ${process.env.CORS_ORIGIN}`)
console.log(
  providers.length
    ? `LLM providers enabled: ${providers.map(p => p.name).join(', ')}`
    : '⚠️  No LLM provider API key found (set GROQ_API_KEY and/or INCEPTION_API_KEY)'
)
// Fetch live model lists at startup (also warms the cache)
for (const p of providers) {
  listModels(p).then(l => {
    if (!l.error) console.log(`[${p.name}] ${l.models.length} models available, default: ${l.defaultModel}`)
  })
}
console.log(`Jira integration: ${isJiraEnabled() ? 'ENABLED' : 'disabled (JIRA_API_KEY not set)'}`)
console.log(
  isAuthConfigured()
    ? 'Application sign-in: ENABLED'
    : '⚠️  Application sign-in is not configured (run npm run auth:setup --workspace=backend)'
)

const app = express()
const PORT = process.env.PORT || 8080

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRouter)
app.use('/api', requireAuth)

// API routes
app.use('/api/config', configRouter)
app.use('/api/jira', jiraRouter)
app.use('/api/generate-tests', generateRouter)

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message)
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  })
})

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found'
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`)
  console.log(`📡 API available at http://localhost:${PORT}/api`)
  console.log(`🔍 Health check at http://localhost:${PORT}/api/health`)
})
