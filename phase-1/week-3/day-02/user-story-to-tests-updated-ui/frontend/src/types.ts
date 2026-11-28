export interface GenerateRequest {
  storyTitle: string
  acceptanceCriteria: string
  description?: string
  additionalInfo?: string
  provider?: string
  model?: string
  autoSwitch?: boolean
  testCaseCount?: number
  categories?: string[]
}

export interface TestCase {
  id: string
  title: string
  steps: string[]
  testData?: string
  expectedResult: string
  category: string
}

export interface AttemptLog {
  provider: string
  providerName: string
  model: string
  ok: boolean
  reason?: string
}

export interface GenerateResponse {
  summary?: string
  requestedCount?: number
  requestedCategories?: string[]
  cases: TestCase[]
  model?: string
  provider?: string
  providerName?: string
  attempts?: AttemptLog[]
  promptTokens: number
  completionTokens: number
}

export interface ProviderInfo {
  id: string
  name: string
  defaultModel: string
  models: string[]
  /** Set when the live model list could not be fetched (e.g. invalid API key) */
  error?: string
}

export interface AppConfig {
  providers: ProviderInfo[]
  autoSwitchDefault: boolean
  jira: {
    enabled: boolean
  }
  aioTests: {
    enabled: boolean
  }
}

export interface JiraCredentials {
  email: string
  baseUrl: string
}

export interface JiraProject {
  id: string
  key: string
  name: string
}

export interface JiraStory {
  key: string
  summary: string
  status?: string
  issueType?: string
  priority?: string
  labels: string[]
  description: string
  acceptanceCriteria: string
  url: string
}
