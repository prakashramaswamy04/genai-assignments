export interface ApprovedAioTestCase {
  id: string
  title: string
  category: string
  steps: string[]
  testData?: string
  expectedResult: string
}

export interface CreatedAioTestCase {
  key: string
}

export class AioTestsError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

function getAioTestsToken(): string | undefined {
  const token = process.env.AIO_TESTS_API_TOKEN?.trim()
  return token || undefined
}

function getAioTestsBaseUrl(): string | undefined {
  const baseUrl = process.env.AIO_TESTS_API_BASE_URL?.trim()
  return baseUrl || undefined
}

export function isAioTestsEnabled(): boolean {
  return !!getAioTestsToken() && !!getAioTestsBaseUrl()
}

export class AioTestsClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor() {
    const token = getAioTestsToken()
    const configuredBaseUrl = getAioTestsBaseUrl()
    if (!token || !configuredBaseUrl) {
      throw new AioTestsError(
        'Configure AIO_TESTS_API_BASE_URL and AIO_TESTS_API_TOKEN on the backend.',
        503
      )
    }

    let url: URL
    try {
      url = new URL(configuredBaseUrl)
    } catch {
      throw new AioTestsError('AIO_TESTS_API_BASE_URL must be a valid HTTPS URL.', 500)
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.replace(/\/+$/, '').endsWith('/api/v1')
    ) {
      throw new AioTestsError(
        'AIO_TESTS_API_BASE_URL must be the HTTPS API URL ending in /api/v1 from AIO Tests settings.',
        500
      )
    }

    this.baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
    this.token = token
  }

  async createTestCase(
    projectKey: string,
    issueKey: string,
    testCase: ApprovedAioTestCase
  ): Promise<CreatedAioTestCase> {
    if (!/^[A-Za-z0-9_]+$/.test(projectKey)) {
      throw new AioTestsError('A valid Jira project key is required.', 400)
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(issueKey)) {
      throw new AioTestsError('A valid Jira issue key is required.', 400)
    }

    const steps = testCase.steps.map((step, index) => ({
      step,
      ...(index === 0 && testCase.testData ? { data: testCase.testData } : {}),
      ...(index === testCase.steps.length - 1 ? { expectedResult: testCase.expectedResult } : {}),
      stepType: 'TEXT'
    }))
    const description = [`Generated from ${testCase.id}`, `Category: ${testCase.category}`].join('\n')
    const created = await this.request(
      `/project/${encodeURIComponent(projectKey)}/testcase`,
      {
        title: testCase.title,
        description,
        steps,
        jiraRequirementIDs: [issueKey]
      }
    )

    if (typeof created.key !== 'string' || !created.key.trim()) {
      throw new AioTestsError(
        'AIO Tests accepted the case but did not return its case key. Verify it in AIO Tests before retrying.',
        502
      )
    }
    return { key: created.key }
  }

  private async request(path: string, body: unknown): Promise<{ key?: unknown }> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `AioAuth ${this.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error'
      })
    } catch (error) {
      throw new AioTestsError(
        `Could not confirm the AIO Tests response: ${(error as Error).message}. Verify AIO Tests before retrying.`,
        502
      )
    }

    if (!response.ok) {
      const text = await response.text()
      let detail = ''
      try {
        const data: unknown = JSON.parse(text)
        const errors = typeof data === 'object' && data !== null
          ? Reflect.get(data, 'errors')
          : undefined
        const messages = typeof data === 'object' && data !== null
          ? [
            Reflect.get(data, 'message'),
            Reflect.get(data, 'error'),
            ...(Array.isArray(errors) ? errors : [])
          ].filter((message): message is string => typeof message === 'string' && !!message.trim())
          : []
        detail = messages.join('; ').slice(0, 500)
      } catch {
        detail = text.slice(0, 200)
      }

      const status = response.status >= 400 && response.status < 600 ? response.status : 502
      throw new AioTestsError(
        detail.split(this.token).join('[redacted]') || `AIO Tests returned HTTP ${response.status}.`,
        status
      )
    }

    try {
      const data: unknown = await response.json()
      return typeof data === 'object' && data !== null && 'key' in data
        ? { key: data.key }
        : {}
    } catch {
      throw new AioTestsError(
        'AIO Tests returned an unreadable success response. Verify AIO Tests before retrying.',
        502
      )
    }
  }
}
