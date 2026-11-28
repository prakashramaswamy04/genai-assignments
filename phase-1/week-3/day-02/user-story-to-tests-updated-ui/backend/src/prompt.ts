import { GenerateRequest } from './schemas'
import { ALL_CATEGORIES, TEST_CATEGORIES, TestCategory } from './categories'

export const SYSTEM_PROMPT = `You are a senior QA engineer with expertise in creating comprehensive test cases from user stories. Your task is to analyze user stories and generate detailed test cases.

CRITICAL: You must return ONLY valid JSON matching this exact schema:

{
  "summary": "string - 2 to 4 sentences summarising what the test cases cover (main flows, key risks, notable edge cases) and any gaps or assumptions",
  "cases": [
    {
      "id": "TC-001",
      "title": "string",
      "steps": ["string", "..."],
      "testData": "string (optional)",
      "expectedResult": "string",
      "category": "string - exactly one of the categories requested by the user"
    }
  ],
  "model": "string (optional)",
  "promptTokens": 0,
  "completionTokens": 0
}

Guidelines:
- Generate test case IDs like TC-001, TC-002, etc.
- Write concise, imperative steps (e.g., "Click login button", "Enter valid email")
- Use ONLY the categories the user requests, spelled exactly as given
- Steps should be actionable and specific
- Expected results should be clear and measurable

Return ONLY the JSON object, no additional text or formatting.`

export function buildPrompt(request: GenerateRequest): string {
  const { storyTitle, acceptanceCriteria, description, additionalInfo, testCaseCount } = request
  const categories: TestCategory[] = request.categories?.length ? request.categories : ALL_CATEGORIES

  let userPrompt = `Generate comprehensive test cases for the following user story:

Story Title: ${storyTitle}

Acceptance Criteria:
${acceptanceCriteria}
`

  if (description) {
    userPrompt += `\nDescription:
${description}
`
  }

  if (additionalInfo) {
    userPrompt += `\nAdditional Information:
${additionalInfo}
`
  }

  userPrompt += `\nGenerate test cases ONLY for these categories (use these exact names in the "category" field):
${categories.map(c => `- ${c}: ${TEST_CATEGORIES[c]}`).join('\n')}

Every selected category must have at least one test case${testCaseCount && testCaseCount < categories.length ? ' where the requested total allows it (prioritise the most important categories)' : ''}. Do not generate test cases for any other category.`

  if (testCaseCount) {
    userPrompt += `\n\nIMPORTANT: Generate EXACTLY ${testCaseCount} test case${testCaseCount === 1 ? '' : 's'} (IDs TC-001 to TC-${String(testCaseCount).padStart(3, '0')}). Prioritise the most important scenarios and distribute them sensibly across the selected categories.`
  }

  userPrompt += `\n\nInclude the "summary" field. Return only the JSON response.`

  return userPrompt
}

/** Maps a model-returned category (e.g. "edge", "EDGE CASES") onto one of the requested names. */
export function normalizeCategory(raw: string, allowed: readonly string[]): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '')
  const r = slug(raw)
  return (
    allowed.find(c => slug(c) === r) ||
    allowed.find(c => r.includes(slug(c)) || slug(c).includes(r)) ||
    raw
  )
}
