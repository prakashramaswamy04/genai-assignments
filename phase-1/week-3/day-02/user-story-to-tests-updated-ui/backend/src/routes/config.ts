import express from 'express'
import { getEnabledProviders, listModels } from '../llm/providers'
import { isJiraEnabled } from '../jira/jiraClient'
import { isAioTestsEnabled } from '../jira/aioTestsClient'

export const configRouter = express.Router()

/**
 * Tells the frontend which features are available.
 * Only providers whose API key exists in .env are returned; API keys are never exposed.
 * Model lists are fetched live from each provider's /models endpoint.
 */
configRouter.get('/', async (_req, res) => {
  const providers = await Promise.all(
    getEnabledProviders().map(async p => {
      const listing = await listModels(p)
      return {
        id: p.id,
        name: p.name,
        defaultModel: listing.defaultModel,
        models: listing.models,
        ...(listing.error ? { error: listing.error } : {})
      }
    })
  )

  res.json({
    providers,
    autoSwitchDefault: (process.env.LLM_AUTO_SWITCH || 'true').toLowerCase() !== 'false',
    // Only the API token comes from .env; email and Jira URL are entered in the UI
    jira: {
      enabled: isJiraEnabled()
    },
    aioTests: {
      enabled: isAioTestsEnabled()
    }
  })
})
