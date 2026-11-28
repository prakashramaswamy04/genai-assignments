import {
  AppConfig,
  GenerateRequest,
  GenerateResponse,
  JiraCredentials,
  JiraProject,
  JiraStory,
  TestCase
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8081/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
  }
  return response.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export interface AuthSession {
  configured: boolean
  authenticated: boolean
  email?: string
}

export function getAuthSession(): Promise<AuthSession> {
  return request<AuthSession>('/auth/session')
}

export function login(email: string, password: string): Promise<{ authenticated: boolean; email: string }> {
  return post('/auth/login', { email, password })
}

export function logout(): Promise<{ authenticated: boolean }> {
  return request('/auth/logout', { method: 'POST' })
}

export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>('/config')
}

export async function generateTests(req: GenerateRequest): Promise<GenerateResponse> {
  try {
    return await post<GenerateResponse>('/generate-tests', req)
  } catch (error) {
    console.error('Error generating tests:', error)
    throw error instanceof Error ? error : new Error('Unknown error occurred')
  }
}

export function connectJira(creds: JiraCredentials) {
  return post<{ connected: boolean; baseUrl: string; user: { displayName: string; email?: string } }>('/jira/connect', creds)
}

export async function getJiraProjects(creds: JiraCredentials): Promise<JiraProject[]> {
  return (await post<{ projects: JiraProject[] }>('/jira/projects', creds)).projects
}

export async function getJiraStories(creds: JiraCredentials, projectKey: string): Promise<JiraStory[]> {
  return (await post<{ stories: JiraStory[] }>('/jira/stories', { ...creds, projectKey })).stories
}

export interface JiraTestCaseApprovalResult {
  issueKey: string
  issueUrl: string
  commentId: string
  commentAdded: true
  issueStatus: string
  statusTransitioned: boolean
  statusAlreadyInProgress: boolean
  statusError?: string
}

export interface AioTestCaseApprovalResult {
  destination: 'aio'
  issueKey: string
  created: Array<{ testCaseId: string; title: string; key: string }>
  failures: Array<{ testCaseId: string; title: string; error: string }>
}

export function approveTestCasesOnJiraStory(
  creds: JiraCredentials,
  projectKey: string,
  issueKey: string,
  testCases: TestCase[]
): Promise<JiraTestCaseApprovalResult> {
  return post('/jira/approve-test-cases', { ...creds, projectKey, issueKey, destination: 'jira', testCases })
}

export function approveTestCasesInAio(
  creds: JiraCredentials,
  projectKey: string,
  issueKey: string,
  testCases: TestCase[]
): Promise<AioTestCaseApprovalResult> {
  return post('/jira/approve-test-cases', { ...creds, projectKey, issueKey, destination: 'aio', testCases })
}
