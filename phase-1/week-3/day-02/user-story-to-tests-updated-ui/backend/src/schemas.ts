import { z } from 'zod'
import { ALL_CATEGORIES, TestCategory } from './categories'

export const GenerateRequestSchema = z.object({
  storyTitle: z.string().min(1, 'Story title is required'),
  acceptanceCriteria: z.string().min(1, 'Acceptance criteria is required'),
  description: z.string().optional(),
  additionalInfo: z.string().optional(),
  /** LLM provider id (e.g. "groq", "inception"). Defaults to the first configured provider. */
  provider: z.string().optional(),
  /** Model id for the chosen provider. Defaults to the provider's default model. */
  model: z.string().optional(),
  /** When true (default), automatically fall back to other models/providers on failure. */
  autoSwitch: z.boolean().optional(),
  /** How many test cases to generate. Omit to let the AI decide. */
  testCaseCount: z.number().int().min(1, 'At least 1 test case').max(50, 'At most 50 test cases').optional(),
  /** Test categories to generate. Omit to use all categories. */
  categories: z
    .array(z.enum(ALL_CATEGORIES as [TestCategory, ...TestCategory[]], {
      errorMap: () => ({ message: `Categories must be from: ${ALL_CATEGORIES.join(', ')}` })
    }))
    .min(1, 'Select at least one test category')
    .optional()
})

export const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  steps: z.array(z.string()),
  testData: z.string().optional(),
  expectedResult: z.string(),
  category: z.string()
})

export const GenerateResponseSchema = z.object({
  /** Short AI-written overview of what the generated test cases cover */
  summary: z.string().optional(),
  cases: z.array(TestCaseSchema),
  model: z.string().optional(),
  promptTokens: z.number(),
  completionTokens: z.number()
})

// Type exports
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>
export type TestCase = z.infer<typeof TestCaseSchema>
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>