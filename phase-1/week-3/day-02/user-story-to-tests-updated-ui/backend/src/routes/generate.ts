import express from 'express'
import { GenerateRequestSchema } from '../schemas'
import { SYSTEM_PROMPT, buildPrompt, normalizeCategory } from '../prompt'
import { ALL_CATEGORIES } from '../categories'
import { AllProvidersFailedError, generateWithFallback } from '../llm/llmRouter'

export const generateRouter = express.Router()

generateRouter.post('/', async (req: express.Request, res: express.Response): Promise<void> => {
  const validationResult = GenerateRequestSchema.safeParse(req.body)
  if (!validationResult.success) {
    res.status(400).json({ error: validationResult.error.issues.map(i => i.message).join(', ') })
    return
  }

  const request = validationResult.data
  const userPrompt = buildPrompt(request)

  try {
    const result = await generateWithFallback(SYSTEM_PROMPT, userPrompt, {
      provider: request.provider,
      model: request.model,
      autoSwitch: request.autoSwitch
    })

    // Make category names match the selected pills exactly (e.g. "Edge" -> "Edge Case")
    const allowed = request.categories?.length ? request.categories : ALL_CATEGORIES
    const normalized = result.response.cases.map(c => ({ ...c, category: normalizeCategory(c.category, allowed) }))

    // Enforce the requested count if the model returned too many
    const cases = request.testCaseCount ? normalized.slice(0, request.testCaseCount) : normalized

    res.json({
      ...result.response,
      cases,
      requestedCount: request.testCaseCount,
      requestedCategories: allowed,
      model: result.model,
      provider: result.provider,
      providerName: result.providerName,
      attempts: result.attempts
    })
  } catch (err) {
    if (err instanceof AllProvidersFailedError) {
      console.error('LLM error:', err.message)
      res.status(err.attempts.length === 0 ? 503 : 502).json({ error: err.message, attempts: err.attempts })
      return
    }
    console.error('Error in generate route:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
