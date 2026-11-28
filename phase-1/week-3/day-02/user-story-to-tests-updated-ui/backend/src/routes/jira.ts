import express from 'express'
import { z } from 'zod'
import { JiraClient, JiraError, isJiraEnabled } from '../jira/jiraClient'
import { AioTestsClient, AioTestsError, isAioTestsEnabled } from '../jira/aioTestsClient'

export const jiraRouter = express.Router()

const CredentialsSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
  baseUrl: z.string().trim().min(1, 'Jira URL is required')
})

const StoriesSchema = CredentialsSchema.extend({
  projectKey: z.string().trim().min(1, 'Project key is required')
})

const ApprovedTestCaseSchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(1).max(100),
  steps: z.array(z.string().trim().min(1).max(4000)).min(1).max(100),
  testData: z.string().max(4000).optional(),
  expectedResult: z.string().trim().min(1).max(4000)
})

const ApproveTestCasesSchema = CredentialsSchema.extend({
  issueKey: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, 'A valid Jira issue key is required'),
  projectKey: z.string().trim().regex(/^[A-Za-z0-9_]+$/, 'A valid Jira project key is required').optional(),
  destination: z.enum(['jira', 'aio']).default('jira'),
  testCases: z.array(ApprovedTestCaseSchema).min(1, 'Select at least one test case').max(50)
})

jiraRouter.use((_req, res, next) => {
  if (
    _req.method === 'POST' &&
    _req.path === '/approve-test-cases' &&
    _req.body?.destination === 'aio'
  ) {
    if (!isAioTestsEnabled()) {
      res.status(503).json({
        error: 'Configure AIO_TESTS_API_BASE_URL and AIO_TESTS_API_TOKEN on the backend.'
      })
      return
    }
    next()
    return
  }

  if (!isJiraEnabled()) {
    res.status(404).json({ error: 'Jira integration is not configured (JIRA_API_KEY missing in .env)' })
    return
  }
  next()
})

function handleError(res: express.Response, err: unknown) {
  if (err instanceof JiraError || err instanceof AioTestsError) {
    res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message })
    return
  }
  console.error('Jira route error:', err)
  res.status(500).json({ error: 'Unexpected error talking to Jira' })
}

function parse<T>(schema: z.ZodType<T>, body: unknown, res: express.Response): T | undefined {
  const result = schema.safeParse(body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues.map(i => i.message).join(', ') })
    return undefined
  }
  return result.data
}

/** Validate credentials and return the Jira user. */
jiraRouter.post('/connect', async (req, res) => {
  const creds = parse(CredentialsSchema, req.body, res)
  if (!creds) return
  try {
    const client = new JiraClient(creds)
    const me = await client.myself()
    res.json({ connected: true, baseUrl: client.url, user: { displayName: me.displayName, email: me.emailAddress } })
  } catch (err) {
    handleError(res, err)
  }
})

jiraRouter.post('/projects', async (req, res) => {
  const creds = parse(CredentialsSchema, req.body, res)
  if (!creds) return
  try {
    const projects = await new JiraClient(creds).listProjects()
    res.json({ projects })
  } catch (err) {
    handleError(res, err)
  }
})

jiraRouter.post('/stories', async (req, res) => {
  const body = parse(StoriesSchema, req.body, res)
  if (!body) return
  try {
    const stories = await new JiraClient(body).listStories(body.projectKey)
    res.json({ stories })
  } catch (err) {
    handleError(res, err)
  }
})

jiraRouter.post('/approve-test-cases', async (req, res) => {
  const body = parse(ApproveTestCasesSchema, req.body, res)
  if (!body) return

  try {
    if (body.destination === 'aio') {
      if (!body.projectKey) {
        res.status(400).json({ error: 'A Jira project key is required for AIO Tests.' })
        return
      }
      const client = new AioTestsClient()
      const created: Array<{ testCaseId: string; title: string; key: string }> = []
      const failures: Array<{ testCaseId: string; title: string; error: string }> = []

      for (const testCase of body.testCases) {
        try {
          const result = await client.createTestCase(body.projectKey, body.issueKey, testCase)
          created.push({ testCaseId: testCase.id, title: testCase.title, key: result.key })
        } catch (err) {
          failures.push({
            testCaseId: testCase.id,
            title: testCase.title,
            error: err instanceof Error ? err.message : 'Could not create this case in AIO Tests.'
          })
        }
      }

      res.status(failures.length ? 207 : 200).json({
        destination: 'aio',
        issueKey: body.issueKey,
        created,
        failures
      })
      return
    }

    const result = await new JiraClient(body).addApprovedTestCasesComment(body.issueKey, body.testCases)
    res.status(result.statusError ? 207 : 200).json(result)
  } catch (err) {
    handleError(res, err)
  }
})
