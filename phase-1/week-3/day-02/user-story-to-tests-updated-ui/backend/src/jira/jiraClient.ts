/**
 * Minimal Jira REST client.
 *
 * The API token lives only in the backend .env (JIRA_API_KEY). The frontend
 * supplies the user's email and Jira base URL with each request.
 */

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

export interface ApprovedJiraTestCase {
  id: string
  title: string
  category: string
  steps: string[]
  testData?: string
  expectedResult: string
}

export interface JiraTestCaseCommentResult {
  issueKey: string
  issueUrl: string
  commentId: string
  commentAdded: true
  issueStatus: string
  statusTransitioned: boolean
  statusAlreadyInProgress: boolean
  statusError?: string
}

export class JiraError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export function getJiraToken(): string | undefined {
  const token = process.env.JIRA_API_KEY || process.env.JIRA_API_TOKEN || process.env.jira_API_KEY
  return token && token.trim() ? token.trim() : undefined
}

export function isJiraEnabled(): boolean {
  return !!getJiraToken()
}

/** Accepts things like "mycompany.atlassian.net/jira/software/..." and returns "https://mycompany.atlassian.net". */
export function normalizeBaseUrl(input: string): string {
  let raw = input.trim()
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new JiraError('Invalid Jira URL', 400)
  }
  if (url.hostname.endsWith('.atlassian.net')) return url.origin
  // Self-hosted Jira may run under a context path (e.g. https://host/jira)
  const path = url.pathname.replace(/\/(browse|projects|secure|jira\/software|rest)\b.*$/i, '').replace(/\/+$/, '')
  return `${url.origin}${path}`
}

export class JiraClient {
  private baseUrl: string
  private authHeader: string

  constructor(creds: JiraCredentials) {
    const token = getJiraToken()
    if (!token) throw new JiraError('JIRA_API_KEY is not configured on the server', 503)
    if (!creds.email?.trim()) throw new JiraError('Email is required', 400)
    this.baseUrl = normalizeBaseUrl(creds.baseUrl)
    const authType = (process.env.JIRA_AUTH_TYPE || 'basic').trim().toLowerCase()
    if (authType === 'bearer') {
      this.authHeader = `Bearer ${token}`
    } else if (authType === 'basic') {
      this.authHeader = 'Basic ' + Buffer.from(`${creds.email.trim()}:${token}`).toString('base64')
    } else {
      throw new JiraError('JIRA_AUTH_TYPE must be either "basic" or "bearer"', 500)
    }
  }

  get url() {
    return this.baseUrl
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(init.headers || {})
        },
        signal: AbortSignal.timeout(20_000)
      })
    } catch (err) {
      throw new JiraError(`Could not reach Jira at ${this.baseUrl}: ${(err as Error).message}`, 502)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = ''
      try {
        const j = JSON.parse(text)
        detail = [...(j.errorMessages || []), ...Object.values(j.errors || {})].join('; ')
      } catch {
        detail = text.slice(0, 200)
      }
      if (res.status === 401) throw new JiraError('Jira rejected the credentials. Check the email and JIRA_API_KEY.', 401)
      if (res.status === 403) throw new JiraError('Your Jira account does not have permission for this action.', 403)
      if (res.status === 404) throw new JiraError(detail || `Not found on ${this.baseUrl}. Check the Jira URL.`, 404)
      throw new JiraError(detail || `Jira error ${res.status}`, res.status)
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  async myself(): Promise<{ displayName: string; emailAddress?: string; accountId?: string }> {
    try {
      return await this.request('/rest/api/3/myself')
    } catch (err) {
      if (err instanceof JiraError && err.status === 404) return this.request('/rest/api/2/myself')
      throw err
    }
  }

  async listProjects(): Promise<JiraProject[]> {
    const projects: JiraProject[] = []
    let startAt = 0
    try {
      for (let page = 0; page < 20; page++) {
        const data = await this.request<{ values: any[]; isLast?: boolean; total?: number }>(
          `/rest/api/3/project/search?startAt=${startAt}&maxResults=50&orderBy=name`
        )
        for (const p of data.values || []) projects.push({ id: p.id, key: p.key, name: p.name })
        if (data.isLast || !data.values?.length) break
        startAt += data.values.length
      }
      return projects
    } catch (err) {
      if (!(err instanceof JiraError) || err.status !== 404) throw err
      // Jira Server / Data Center
      const list = await this.request<any[]>('/rest/api/2/project')
      return list
        .map(p => ({ id: p.id, key: p.key, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  async addApprovedTestCasesComment(
    issueKey: string,
    testCases: ApprovedJiraTestCase[]
  ): Promise<JiraTestCaseCommentResult> {
    const normalizedIssueKey = issueKey.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(normalizedIssueKey)) {
      throw new JiraError('A valid Jira issue key is required.', 400)
    }

    const encodedKey = encodeURIComponent(normalizedIssueKey)
    const issue = await this.request<{ fields: { status: { name: string } } }>(
      `/rest/api/3/issue/${encodedKey}?fields=status`
    )
    const currentStatus = issue.fields.status.name
    const alreadyInProgress = currentStatus.trim().toLowerCase() === 'in progress'
    let transitionId: string | undefined
    let statusError: string | undefined

    if (!alreadyInProgress) {
      try {
        const { transitions } = await this.request<{
          transitions: Array<{ id: string; to?: { name: string } }>
        }>(`/rest/api/3/issue/${encodedKey}/transitions`)
        transitionId = transitions.find(
          transition => transition.to?.name.trim().toLowerCase() === 'in progress'
        )?.id
        if (!transitionId) statusError = 'No available Jira workflow transition leads to In Progress.'
      } catch (error) {
        if (error instanceof JiraError) {
          statusError = error.message
        } else {
          console.error(`Could not check transitions for Jira issue ${normalizedIssueKey}:`, error)
          statusError = 'Could not check Jira workflow transitions.'
        }
      }
    }

    const lines = [
      'Approved test cases from the User Story and Test Case Generator',
      ...testCases.flatMap(testCase => [
        '',
        `${testCase.id}: ${testCase.title}`,
        `Category: ${testCase.category}`,
        ...testCase.steps.map((step, index) => `Step ${index + 1}: ${step}`),
        ...(testCase.testData ? [`Test data: ${testCase.testData}`] : []),
        `Expected result: ${testCase.expectedResult}`
      ])
    ]
    const commentText = lines.join('\n')
    if (commentText.length > 30_000) {
      throw new JiraError('The selected test cases are too long for one Jira comment. Approve fewer cases at a time.', 400)
    }

    const comment = await this.request<{ id: string }>(`/rest/api/3/issue/${encodedKey}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: lines.filter(Boolean).map(line => ({
            type: 'paragraph',
            content: line ? [{ type: 'text', text: line }] : []
          }))
        }
      })
    })

    let statusTransitioned = false
    let resultingStatus = currentStatus
    if (!alreadyInProgress && transitionId && !statusError) {
      try {
        await this.request<void>(`/rest/api/3/issue/${encodedKey}/transitions`, {
          method: 'POST',
          body: JSON.stringify({ transition: { id: transitionId } })
        })
        statusTransitioned = true
        resultingStatus = 'In Progress'
      } catch (error) {
        if (error instanceof JiraError) {
          statusError = error.message
        } else {
          console.error(`Comment was added, but Jira issue ${normalizedIssueKey} could not be transitioned:`, error)
          statusError = 'Comment was added, but the Jira status transition failed unexpectedly.'
        }
      }
    }

    return {
      issueKey: normalizedIssueKey,
      issueUrl: `${this.baseUrl}/browse/${normalizedIssueKey}`,
      commentId: comment.id,
      commentAdded: true,
      issueStatus: resultingStatus,
      statusTransitioned,
      statusAlreadyInProgress: alreadyInProgress,
      ...(statusError ? { statusError } : {})
    }
  }

  // ----- Acceptance Criteria custom field discovery -----

  private static acFieldCache = new Map<string, string[]>()

  private async acceptanceCriteriaFields(): Promise<string[]> {
    const fromEnv = process.env.JIRA_ACCEPTANCE_CRITERIA_FIELD
    if (fromEnv) return fromEnv.split(',').map(s => s.trim()).filter(Boolean)

    const cached = JiraClient.acFieldCache.get(this.baseUrl)
    if (cached) return cached
    let ids: string[] = []
    try {
      const fields = await this.request<Array<{ id: string; name: string }>>('/rest/api/3/field')
      ids = fields.filter(f => /acceptance\s*criteria/i.test(f.name)).map(f => f.id)
    } catch (err) {
      console.warn('Could not look up Jira fields:', (err as Error).message)
    }
    JiraClient.acFieldCache.set(this.baseUrl, ids)
    return ids
  }

  // ----- Stories -----

  async listStories(projectKey: string): Promise<JiraStory[]> {
    if (!/^[A-Za-z0-9_]+$/.test(projectKey)) throw new JiraError('Invalid project key', 400)

    const acFields = await this.acceptanceCriteriaFields()
    const fields = ['summary', 'description', 'status', 'issuetype', 'priority', 'labels', ...acFields]
    const types = (process.env.JIRA_ISSUE_TYPES || 'Story')
      .split(',').map(t => `"${t.trim().replace(/"/g, '')}"`).filter(t => t !== '""').join(', ')

    const typedJql = `project = "${projectKey}" AND issuetype in (${types}) ORDER BY updated DESC`
    const anyJql = `project = "${projectKey}" AND issuetype not in subTaskIssueTypes() AND issuetype != Epic ORDER BY updated DESC`

    let issues: any[]
    try {
      issues = await this.search(typedJql, fields)
    } catch (err) {
      // Project may not have a "Story" issue type (e.g. some team-managed projects)
      if (err instanceof JiraError && err.status === 400) {
        issues = await this.search(anyJql, fields)
      } else {
        throw err
      }
    }

    return issues.map(issue => this.toStory(issue, acFields))
  }

  private async search(jql: string, fields: string[]): Promise<any[]> {
    const max = Number(process.env.JIRA_MAX_STORIES) || 300
    const issues: any[] = []

    // Jira Cloud: enhanced search endpoint (token-based pagination)
    try {
      let nextPageToken: string | undefined
      do {
        const data = await this.request<{ issues: any[]; nextPageToken?: string }>('/rest/api/3/search/jql', {
          method: 'POST',
          body: JSON.stringify({ jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) })
        })
        issues.push(...(data.issues || []))
        nextPageToken = data.nextPageToken
      } while (nextPageToken && issues.length < max)
      return issues.slice(0, max)
    } catch (err) {
      if (!(err instanceof JiraError) || (err.status !== 404 && err.status !== 405)) throw err
    }

    // Jira Server / Data Center fallback
    let startAt = 0
    while (issues.length < max) {
      const data = await this.request<{ issues: any[]; total: number }>('/rest/api/2/search', {
        method: 'POST',
        body: JSON.stringify({ jql, fields, startAt, maxResults: 100 })
      })
      issues.push(...(data.issues || []))
      if (!data.issues?.length || issues.length >= data.total) break
      startAt += data.issues.length
    }
    return issues.slice(0, max)
  }

  private toStory(issue: any, acFields: string[]): JiraStory {
    const f = issue.fields || {}
    let description = toPlainText(f.description)
    let acceptanceCriteria = acFields.map(id => toPlainText(f[id])).filter(Boolean).join('\n').trim()

    if (!acceptanceCriteria) {
      const split = splitAcceptanceCriteria(description)
      description = split.description
      acceptanceCriteria = split.acceptanceCriteria
    }

    return {
      key: issue.key,
      summary: f.summary || '',
      status: f.status?.name,
      issueType: f.issuetype?.name,
      priority: f.priority?.name,
      labels: f.labels || [],
      description,
      acceptanceCriteria,
      url: `${this.baseUrl}/browse/${issue.key}`
    }
  }
}

// ---------- Helpers: Atlassian Document Format -> plain text ----------

export function toPlainText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return cleanWikiMarkup(value).trim()
  if (typeof value === 'object') return adfToText(value as AdfNode).replace(/\n{3,}/g, '\n\n').trim()
  return String(value)
}

interface AdfNode {
  type?: string
  text?: string
  content?: AdfNode[]
  attrs?: Record<string, any>
}

function adfToText(node: AdfNode, ctx: { listDepth: number; ordered?: boolean; index?: number } = { listDepth: 0 }): string {
  if (!node) return ''
  const children = (c = ctx) => (node.content || []).map(child => adfToText(child, c)).join('')

  switch (node.type) {
    case 'doc':
      return children()
    case 'text':
      return node.text || ''
    case 'hardBreak':
      return '\n'
    case 'paragraph':
      return children() + '\n'
    case 'heading':
      return '\n' + children() + '\n'
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList'
      return (node.content || [])
        .map((item, i) => adfToText(item, { listDepth: ctx.listDepth + 1, ordered, index: i + 1 }))
        .join('') + (ctx.listDepth === 0 ? '\n' : '')
    }
    case 'listItem': {
      const indent = '  '.repeat(Math.max(0, ctx.listDepth - 1))
      const marker = ctx.ordered ? `${ctx.index}. ` : '- '
      const inner = (node.content || [])
        .map(child => adfToText(child, { listDepth: ctx.listDepth }))
        .join('')
        .replace(/\n+$/, '')
      return `${indent}${marker}${inner}\n`
    }
    case 'codeBlock':
      return children() + '\n'
    case 'table':
      return (node.content || []).map(row => adfToText(row, ctx)).join('') + '\n'
    case 'tableRow':
      return (node.content || []).map(cell => adfToText(cell, ctx).replace(/\n+/g, ' ').trim()).join(' | ') + '\n'
    case 'mention':
      return node.attrs?.text || ''
    case 'emoji':
      return node.attrs?.text || node.attrs?.shortName || ''
    case 'inlineCard':
    case 'blockCard':
      return node.attrs?.url || ''
    case 'rule':
      return '\n'
    default:
      return children()
  }
}

/** Light clean-up of Jira wiki markup (Server/DC v2 API returns strings). */
function cleanWikiMarkup(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/^h[1-6]\.\s*/gm, '')
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/^\s*#\s+/gm, '1. ')
    .replace(/\{(code|noformat)[^}]*\}/g, '')
}

/** If the description contains an "Acceptance Criteria" section, split it out. */
export function splitAcceptanceCriteria(text: string): { description: string; acceptanceCriteria: string } {
  const match = text.match(/^\s*(?:#+\s*|\*+\s*)?acceptance\s+criteria\s*:?\s*\**\s*$/im)
    || text.match(/acceptance\s+criteria\s*:/i)
  if (!match || match.index === undefined) return { description: text, acceptanceCriteria: '' }
  return {
    description: text.slice(0, match.index).trim(),
    acceptanceCriteria: text.slice(match.index + match[0].length).trim()
  }
}
