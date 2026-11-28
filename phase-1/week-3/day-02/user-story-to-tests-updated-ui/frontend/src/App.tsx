import { Fragment, useEffect, useRef, useState } from 'react'
import { AioTestCaseApprovalResult, approveTestCasesInAio, approveTestCasesOnJiraStory, generateTests, getAuthSession, getConfig, JiraTestCaseApprovalResult, login, logout } from './api'
import { AppConfig, GenerateRequest, GenerateResponse, JiraCredentials, JiraStory, TestCase } from './types'
import { ModelSelector } from './components/ModelSelector'
import { JiraPanel } from './components/JiraPanel'

const PREFS_KEY = 'llm-preferences'
const THEME_KEY = 'user-story-tests-theme'
const MAX_TEST_CASES = 50
const COUNT_PRESETS = [5, 10, 15, 20]
/** Must match backend/src/categories.ts */
const TEST_CATEGORIES: Array<{ name: string; icon: string; hint: string }> = [
  { name: 'Functional', icon: '✅', hint: 'Happy-path behaviour for each acceptance criterion' },
  { name: 'Negative', icon: '⛔', hint: 'Invalid input and error handling' },
  { name: 'Boundary', icon: '📏', hint: 'Min/max limits, just inside and outside' },
  { name: 'Edge Case', icon: '🧩', hint: 'Unusual but possible situations' },
  { name: 'UI', icon: '🖥️', hint: 'Layout, labels, messages, field states' },
  { name: 'Accessibility', icon: '♿', hint: 'Keyboard, screen readers, contrast (WCAG)' },
  { name: 'Security', icon: '🔒', hint: 'Auth, roles, injection, data exposure' },
  { name: 'Usability', icon: '🙂', hint: 'Ease of use and clarity' }
]
const CATEGORY_ORDER = TEST_CATEGORIES.map(c => c.name)

/** "Edge Case" -> "category-edge-case" */
function categoryClass(category: string): string {
  return `category-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

/** Only one category is selected when the page loads */
const DEFAULT_CATEGORIES = ['Functional']

function categoryCounts(cases: TestCase[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const c of cases) counts.set(c.category, (counts.get(c.category) || 0) + 1)
  const rank = (k: string) => {
    const i = CATEGORY_ORDER.findIndex(c => c.toLowerCase() === k.toLowerCase())
    return i === -1 ? CATEGORY_ORDER.length : i
  }
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark'
    } catch {
      return false
    }
  })
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [jiraExportContext, setJiraExportContext] = useState<{ credentials: JiraCredentials | null; projectKey: string }>({
    credentials: null,
    projectKey: ''
  })
  const [selectedJiraStoryKey, setSelectedJiraStoryKey] = useState<string | null>(null)
  const [approvalDestination, setApprovalDestination] = useState<'jira' | 'aio'>('jira')
  const [selectedTestCases, setSelectedTestCases] = useState<Set<string>>(new Set())
  const [approvedTestCaseIds, setApprovedTestCaseIds] = useState<Set<string>>(new Set())
  const [jiraApprovalResult, setJiraApprovalResult] = useState<JiraTestCaseApprovalResult | null>(null)
  const [aioApprovalResult, setAioApprovalResult] = useState<AioTestCaseApprovalResult | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [isApprovingTestCases, setIsApprovingTestCases] = useState(false)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [autoSwitch, setAutoSwitch] = useState(true)
  /** '' = let the AI decide */
  const [testCaseCount, setTestCaseCount] = useState<string>('')
  const isCustomCount = testCaseCount !== '' && !COUNT_PRESETS.map(String).includes(testCaseCount)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(DEFAULT_CATEGORIES)
  const outputRef = useRef<HTMLDivElement>(null)
  const toggleTheme = () => setIsDarkMode(value => !value)
  const themeToggle = (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDarkMode ? 'day' : 'night'} mode`}
      aria-pressed={isDarkMode}
    >
      <span aria-hidden="true">{isDarkMode ? '☀️' : '🌙'}</span>
      {isDarkMode ? 'Day mode' : 'Night mode'}
    </button>
  )
  const scrollToOutput = () =>
    requestAnimationFrame(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

  const toggleCategory = (name: string) => {
    setSelectedCategories(prev =>
      prev.includes(name)
        ? prev.filter(c => c !== name)
        : CATEGORY_ORDER.filter(c => c === name || prev.includes(c)) // keep canonical order
    )
  }
  const allCategoriesSelected = selectedCategories.length === CATEGORY_ORDER.length

  useEffect(() => {
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light'
    try {
      localStorage.setItem(THEME_KEY, isDarkMode ? 'dark' : 'light')
    } catch {
      // Theme selection still works when browser storage is unavailable.
    }
  }, [isDarkMode])

  useEffect(() => {
    let cancelled = false
    getAuthSession()
      .then(session => {
        if (cancelled) return
        setAuthConfigured(session.configured)
        setIsAuthenticated(session.authenticated)
        if (!session.configured) {
          setLoginError('Sign-in is not configured. Run npm run auth:setup --workspace=backend in the project terminal.')
        }
      })
      .catch(err => {
        if (!cancelled) {
          setLoginError(`Could not check sign-in status: ${err instanceof Error ? err.message : err}`)
        }
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    getConfig()
      .then(cfg => {
        if (cancelled) return
        setConfig(cfg)
        let prefs: { provider?: string; model?: string; autoSwitch?: boolean } = {}
        try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } catch { /* ignore */ }
        const p = cfg.providers.find(x => x.id === prefs.provider) || cfg.providers[0]
        if (p) {
          setProvider(p.id)
          setModel(prefs.model && p.models.includes(prefs.model) ? prefs.model : p.defaultModel)
        }
        setAutoSwitch(prefs.autoSwitch ?? cfg.autoSwitchDefault)
      })
      .catch(err => {
        if (!cancelled) setConfigError(`Could not reach the backend: ${err instanceof Error ? err.message : err}`)
      })
    return () => { cancelled = true }
  }, [isAuthenticated])

  useEffect(() => {
    if (!provider) return
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ provider, model, autoSwitch })) } catch { /* ignore */ }
  }, [provider, model, autoSwitch])

  const handleProviderChange = (id: string) => {
    setProvider(id)
    const p = config?.providers.find(x => x.id === id)
    if (p) setModel(p.defaultModel)
  }

  const handleLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoginError(null)
    setIsSigningIn(true)
    try {
      await login(loginEmail, loginPassword)
      setLoginPassword('')
      setIsAuthenticated(true)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await logout()
      setIsAuthenticated(false)
      setConfig(null)
      setError(null)
    } catch (err) {
      setError(`Could not sign out: ${err instanceof Error ? err.message : err}`)
    }
  }

  const handleStorySelected = (story: JiraStory | null) => {
    setSelectedJiraStoryKey(story?.key || null)
    if (!story) {
      setJiraApprovalResult(null)
      setAioApprovalResult(null)
      setApprovalError(null)
      return
    }
    const meta = [
      `Jira: ${story.key}`,
      story.issueType && `Type: ${story.issueType}`,
      story.priority && `Priority: ${story.priority}`,
      story.status && `Status: ${story.status}`,
      story.labels.length > 0 && `Labels: ${story.labels.join(', ')}`
    ].filter(Boolean).join(' | ')

    setFormData({
      storyTitle: story.summary,
      description: story.description,
      acceptanceCriteria: story.acceptanceCriteria,
      additionalInfo: meta
    })
    setResults(null)
    setError(null)
    setSelectedTestCases(new Set())
    setApprovedTestCaseIds(new Set())
    setJiraApprovalResult(null)
    setAioApprovalResult(null)
    setApprovalError(null)
  }

  const [formData, setFormData] = useState<GenerateRequest>({
    storyTitle: '',
    acceptanceCriteria: '',
    description: '',
    additionalInfo: ''
  })
  const [results, setResults] = useState<GenerateResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedTestCases, setExpandedTestCases] = useState<Set<string>>(new Set())

  const toggleTestCaseExpansion = (testCaseId: string) => {
    const newExpanded = new Set(expandedTestCases)
    if (newExpanded.has(testCaseId)) {
      newExpanded.delete(testCaseId)
    } else {
      newExpanded.add(testCaseId)
    }
    setExpandedTestCases(newExpanded)
  }

  const handleInputChange = (field: keyof GenerateRequest, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.storyTitle.trim() || !formData.acceptanceCriteria.trim()) {
      setError('Story Title and Acceptance Criteria are required')
      return
    }

    if (selectedCategories.length === 0) {
      setError('Select at least one test category')
      return
    }

    const count = testCaseCount.trim() ? Number(testCaseCount) : undefined
    if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > MAX_TEST_CASES)) {
      setError(`Number of test cases must be a whole number between 1 and ${MAX_TEST_CASES}`)
      return
    }

    setIsLoading(true)
    setError(null)
    scrollToOutput()

    try {
      const response = await generateTests({
        ...formData,
        provider: provider || undefined,
        model: model || undefined,
        autoSwitch,
        testCaseCount: count,
        categories: selectedCategories
      })
      setResults(response)
      setSelectedTestCases(new Set())
      setApprovedTestCaseIds(new Set())
      setJiraApprovalResult(null)
      setAioApprovalResult(null)
      setApprovalError(null)
      scrollToOutput()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate tests')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleTestCaseApproval = (testCaseId: string) => {
    if (approvedTestCaseIds.has(testCaseId)) return
    setSelectedTestCases(previous => {
      const next = new Set(previous)
      if (next.has(testCaseId)) next.delete(testCaseId)
      else next.add(testCaseId)
      return next
    })
  }

  const handleSelectAllTestCases = () => {
    if (!results) return
    const availableIds = results.cases
      .filter(testCase => !approvedTestCaseIds.has(testCase.id))
      .map(testCase => testCase.id)
    const allAvailableSelected = availableIds.length > 0 && availableIds.every(id => selectedTestCases.has(id))
    setSelectedTestCases(allAvailableSelected ? new Set() : new Set(availableIds))
  }

  const handleApproveTestCases = async () => {
    if (!results) return
    const credentials = jiraExportContext.credentials
    if (!credentials || !jiraExportContext.projectKey || !selectedJiraStoryKey) {
      setApprovalError('Connect to Jira and select the Jira story these test cases belong to.')
      return
    }
    if (approvalDestination === 'aio' && !config?.aioTests?.enabled) {
      setApprovalError('Configure AIO_TESTS_API_BASE_URL and AIO_TESTS_API_TOKEN on the backend first.')
      return
    }

    const selected = results.cases.filter(testCase =>
      selectedTestCases.has(testCase.id) && !approvedTestCaseIds.has(testCase.id)
    )
    if (selected.length === 0) return

    setIsApprovingTestCases(true)
    setApprovalError(null)
    setJiraApprovalResult(null)
    setAioApprovalResult(null)
    try {
      if (approvalDestination === 'jira') {
        const response = await approveTestCasesOnJiraStory(
          credentials,
          jiraExportContext.projectKey,
          selectedJiraStoryKey,
          selected
        )
        setJiraApprovalResult(response)
        setApprovedTestCaseIds(previous => new Set([...previous, ...selected.map(testCase => testCase.id)]))
        setSelectedTestCases(previous => new Set([...previous].filter(id => !selected.some(testCase => testCase.id === id))))
      } else {
        const response = await approveTestCasesInAio(
          credentials,
          jiraExportContext.projectKey,
          selectedJiraStoryKey,
          selected
        )
        setAioApprovalResult(response)
        const createdIds = new Set(response.created.map(testCase => testCase.testCaseId))
        setApprovedTestCaseIds(previous => new Set([...previous, ...createdIds]))
        setSelectedTestCases(previous => new Set([...previous].filter(id => !createdIds.has(id))))
      }
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : 'Could not approve the selected test cases.')
    } finally {
      setIsApprovingTestCases(false)
    }
  }

  const availableTestCaseIds = results?.cases
    .filter(testCase => !approvedTestCaseIds.has(testCase.id))
    .map(testCase => testCase.id) || []
  const allAvailableTestCasesSelected = availableTestCaseIds.length > 0 &&
    availableTestCaseIds.every(id => selectedTestCases.has(id))
  const selectedTestCaseCount = results?.cases.filter(testCase =>
    selectedTestCases.has(testCase.id) && !approvedTestCaseIds.has(testCase.id)
  ).length || 0

  return (
    <div className={`app-shell ${isDarkMode ? 'dark-theme' : ''}`}>
      <style>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        :root {
          --bg: #f4f7f3;
          --surface: #ffffff;
          --border: #e3e8e0;
          --text: #1f2a24;
          --muted: #6b7a72;
          --brand: #00c853;
          --brand-dark: #009624;
          --brand-darker: #00791d;
          --brand-soft: #e6f7ec;
        }

        :root[data-theme='dark'] {
          color-scheme: dark;
          --bg: #111813;
          --surface: #1b251e;
          --border: #354238;
          --text: #e5eee7;
          --muted: #a4b2a8;
          --brand: #35d879;
          --brand-dark: #20b95e;
          --brand-darker: #79e7a5;
          --brand-soft: #203b2a;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          color: var(--text);
          line-height: 1.6;
          min-height: 100vh;
          background:
            radial-gradient(900px 500px at 8% -8%, rgba(0,200,83,0.14), transparent 55%),
            radial-gradient(700px 400px at 100% 0%, rgba(0,200,83,0.08), transparent 50%),
            var(--bg);
          background-attachment: fixed;
        }

        .dark-theme .form-input, .dark-theme .form-textarea,
        .dark-theme .form-select, .dark-theme .count-chip,
        .dark-theme .secondary-btn, .dark-theme .stat {
          color: var(--text);
          background-color: #202c23;
          border-color: var(--border);
        }
        .dark-theme .form-input::placeholder, .dark-theme .form-textarea::placeholder { color: #84958a; }
        .dark-theme .form-select {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%23a4b2a8' stroke-width='1.6' d='M1 1l5 5 5-5'/%3E%3C/svg%3E");
        }
        .dark-theme .results-table th { background: #222e25; color: var(--muted); }
        .dark-theme .results-table td { border-color: #2b382e; }
        .dark-theme .results-table tbody tr.row-main:hover { background: #202c23; }
        .dark-theme .placeholder-hints .meta-chip { background: #202c23; }
        .dark-theme .summary-card { background: linear-gradient(180deg, #202c23, #1b251e); }
        .dark-theme .expanded-details { background: #202c23; }
        .dark-theme .step-item { background: #1b251e; }
        .dark-theme .panel { background: #202c23; }
        .dark-theme .panel-warn, .dark-theme .switch-notice { background: #332d1d; border-color: #64552b; color: #f0d98a; }
        .dark-theme .switch-notice .reason { color: #c3b987; }
        .dark-theme .panel code, .dark-theme .modal code { background: #303d33; }
        .dark-theme .cat-pill:not(.active) { background: #202c23; }
        .dark-theme .cat-pill.active { background: #e5eee7; border-color: #e5eee7; color: #172019; }
        .dark-theme .cat-pill.active:hover { background: #cbd9ce; border-color: #cbd9ce; }
        .dark-theme .category-functional, .dark-theme .category-positive { color: #8ce2aa; background: #203b2a; border-color: #356446; }
        .dark-theme .category-negative { color: #ffaaa3; background: #452624; border-color: #713c38; }
        .dark-theme .category-boundary, .dark-theme .category-edge-case, .dark-theme .category-edge { color: #f2d579; background: #3a321e; border-color: #66572c; }
        .dark-theme .category-ui { color: #8bdce3; background: #1d383b; border-color: #315d61; }
        .dark-theme .category-accessibility, .dark-theme .category-non-functional { color: #a9c5ff; background: #222f49; border-color: #3b527a; }
        .dark-theme .category-security, .dark-theme .category-authorization { color: #d7b2f6; background: #352642; border-color: #59406d; }
        .dark-theme .category-usability { color: #f1a9cc; background: #412638; border-color: #693e58; }
        .dark-theme .error-banner, .dark-theme .inline-error { background: #3b2423; border-color: #69403d; color: #ffaaa3; }
        .dark-theme .story-loaded { background: #203b2a; }
        .dark-theme .story-warn { color: #f2d579; }
        .dark-theme .jira-btn { background: #1e2d43; border-color: #345681; color: #a9c9ff; }
        .dark-theme .jira-btn:hover:not(:disabled) { background: #273a56; }
        .dark-theme .form-select:disabled { background-color: #202c23; }
        .dark-theme .approval-toolbar { background: #202c23; }
        .dark-theme .approval-success { background: #203b2a; border-color: #356446; color: #8ce2aa; }
        .dark-theme .approval-failures { background: #3a321e; border-color: #66572c; color: #f2d579; }
        .dark-theme .secondary-btn:hover:not(:disabled) { background: #29372d; }

        .theme-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 9px 14px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: var(--surface);
          color: var(--text);
          font: inherit;
          font-size: 13px;
          font-weight: 650;
          cursor: pointer;
          transition: border-color 0.2s, transform 0.15s, background 0.2s;
        }
        .theme-toggle:hover { border-color: var(--brand); transform: translateY(-1px); }
        .theme-toggle:focus-visible { outline: 3px solid rgba(0,200,83,0.35); outline-offset: 2px; }

        .login-page {
          min-height: 100vh;
          padding: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .login-topbar { width: min(1120px, 100%); display: flex; justify-content: flex-end; }
        .login-card {
          width: min(440px, 100%);
          margin: auto;
          padding: 36px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          box-shadow: 0 18px 50px rgba(31,42,36,0.1);
          animation: fadeUp 0.5s ease both;
        }
        .login-brand {
          width: 52px; height: 52px;
          display: grid; place-items: center;
          margin-bottom: 22px;
          border-radius: 16px;
          background: var(--brand-soft);
          font-size: 25px;
        }
        .login-eyebrow { color: var(--brand-darker); font-size: 12px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; }
        .login-title { margin: 7px 0 8px; font-size: 1.8rem; line-height: 1.2; letter-spacing: -0.03em; }
        .login-description { color: var(--muted); font-size: 14px; margin-bottom: 26px; }
        .login-form .form-group { margin-bottom: 18px; }
        .login-submit { width: 100%; margin-top: 6px; }
        .login-footnote { margin-top: 18px; color: var(--muted); text-align: center; font-size: 12px; }
        .app-header-tools { display: flex; justify-content: center; gap: 10px; margin-top: 18px; }
        .sign-out-btn { background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 999px; padding: 8px 13px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
        .sign-out-btn:hover { border-color: var(--brand); color: var(--text); }
        @media (max-width: 520px) {
          .login-page { padding: 16px; }
          .login-card { padding: 26px 22px; }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes floatGlow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .container {
          max-width: 95%;
          width: 100%;
          margin: 0 auto;
          padding: 24px;
          min-height: 100vh;
        }

        @media (min-width: 768px) { .container { max-width: 92%; padding: 36px; } }
        @media (min-width: 1024px) { .container { max-width: 90%; padding: 44px; } }
        @media (min-width: 1600px) { .container { max-width: 1600px; padding: 52px; } }

        .header {
          text-align: center;
          margin-bottom: 40px;
          animation: fadeUp 0.6s ease both;
        }

        .badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 999px;
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.35);
          color: var(--brand-darker);
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 18px;
        }

        .badge-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--brand);
          box-shadow: 0 0 12px var(--brand);
          animation: floatGlow 2.4s ease-in-out infinite;
        }

        .title {
          font-size: clamp(2.1rem, 5vw, 3.2rem);
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--text);
          margin-bottom: 12px;
        }
        .title .accent { color: var(--brand-dark); }

        .subtitle {
          color: var(--muted);
          font-size: 1.05rem;
          max-width: 560px;
          margin: 0 auto;
        }

        /* Stacked workspace: horizontal input form on top, results below */
        .workspace {
          display: flex;
          flex-direction: column;
          gap: 26px;
        }

        .form-container {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 24px 28px;
          box-shadow: 0 10px 30px rgba(31,42,36,0.06);
          animation: fadeUp 0.6s ease 0.08s both;
        }

        .form-group { margin-bottom: 18px; min-width: 0; }

        /* Horizontal rows inside the form */
        .form-row { display: grid; gap: 18px 22px; align-items: start; }
        .form-row > .form-group { margin-bottom: 0; }
        .form-row + .form-group, .form-group + .form-row, .form-row + .form-row { margin-top: 0; }
        .form-row { margin-bottom: 18px; }

        /* AI engine + Jira: side by side, a single panel fills the row */
        .panels-row { grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); align-items: stretch; }
        @media (max-width: 600px) {
          .container { padding: 16px; }
          .form-container { padding: 18px 16px; }
          .results-container { padding: 18px 16px; }
        }
        .panels-row .panel { margin-bottom: 0; }
        .panels-row > div { min-width: 0; display: flex; flex-direction: column; }
        .panels-row > div > .panel { flex: 1; }

        .cols-3 { grid-template-columns: 1fr; }
        .options-row { grid-template-columns: 1fr; }
        @media (min-width: 900px) {
          .cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .options-row { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }
        }
        .options-row .count-group { margin-top: 0; }

        .form-actions {
          display: flex;
          justify-content: flex-end;
          padding-top: 18px;
          border-top: 1px solid var(--border);
        }
        .form-actions .submit-btn { margin-top: 0; width: auto; min-width: 260px; }
        @media (max-width: 600px) {
          .form-actions .submit-btn { width: 100%; min-width: 0; }
        }
        .approval-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 14px 16px;
          margin: 8px 0 12px;
          background: #f8fbf6;
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        .approval-toolbar-title { font-weight: 700; font-size: 14px; }
        .approval-toolbar-note { color: var(--muted); font-size: 12.5px; }
        .approval-actions { display: flex; align-items: center; gap: 10px; }
        .approval-actions .submit-btn { width: auto; min-width: 0; margin: 0; padding: 10px 16px; }
        .approval-destination-select { width: auto; min-width: 130px; }
        .approval-link-btn { color: var(--brand-darker); background: transparent; border: 0; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .approval-link-btn:disabled { color: var(--muted); cursor: not-allowed; }
        .approval-status { margin-bottom: 12px; padding: 10px 14px; border-radius: 10px; font-size: 13px; }
        .approval-success { background: #e6f7ec; border: 1px solid #b7e4c7; color: #1f8a4c; }
        .approval-success a { color: inherit; font-weight: 700; }
        .approval-failures { background: #fcf3d9; border: 1px solid #f0dca0; color: #6b5200; }
        .approval-status ul { margin: 6px 0 0 18px; }
        .approval-checkbox { width: 17px; height: 17px; accent-color: var(--brand-dark); cursor: pointer; vertical-align: middle; }
        .approval-checkbox:disabled { cursor: default; }
        @media (max-width: 640px) {
          .approval-toolbar { align-items: flex-start; flex-direction: column; }
          .approval-actions { width: 100%; justify-content: space-between; }
          .approval-actions .submit-btn { flex: 1; }
        }

        .form-label {
          display: block;
          font-weight: 600;
          margin-bottom: 8px;
          color: var(--text);
          font-size: 14px;
        }
        .form-label .req { color: var(--brand-dark); margin-left: 3px; }

        .form-input, .form-textarea {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: 11px;
          font-size: 14px;
          color: var(--text);
          background: #fbfdfa;
          transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
          font-family: inherit;
        }

        .form-input::placeholder, .form-textarea::placeholder { color: #9aa89f; }

        .form-input:focus, .form-textarea:focus {
          outline: none;
          border-color: var(--brand);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(0,200,83,0.18);
        }

        .form-textarea { resize: none; min-height: 96px; }
        .form-textarea.tall { min-height: 120px; }

        .submit-btn {
          margin-top: 20px;
          width: 100%;
          background: linear-gradient(120deg, var(--brand), var(--brand-dark));
          color: #fff;
          border: none;
          padding: 13px 28px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.25s ease, filter 0.2s;
          box-shadow: 0 8px 22px rgba(0,200,83,0.35);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 14px 30px rgba(0,200,83,0.45);
          filter: brightness(1.03);
        }
        .submit-btn:active:not(:disabled) { transform: translateY(0); }

        .submit-btn:disabled {
          cursor: not-allowed;
          background: #c6d4bb;
          box-shadow: none;
        }

        .btn-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.5);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        .output-col { min-width: 0; }

        .error-banner {
          background: #fdeceb;
          border: 1px solid #f5c2be;
          color: #b3261e;
          padding: 14px 18px;
          border-radius: 12px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          animation: fadeUp 0.3s ease both;
        }

        .placeholder-card {
          background:
            radial-gradient(400px 200px at 50% 0%, rgba(0,200,83,0.08), transparent 70%),
            var(--surface);
          border: 1px dashed rgba(0,200,83,0.45);
          border-radius: 18px;
          padding: 40px 34px;
          text-align: center;
          color: var(--muted);
          min-height: 240px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          animation: fadeUp 0.5s ease both;
        }
        .placeholder-icon {
          width: 76px;
          height: 76px;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 36px;
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.35);
          margin-bottom: 20px;
          animation: floatGlow 3s ease-in-out infinite;
        }
        .placeholder-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 8px;
        }
        .placeholder-text { max-width: 360px; font-size: 14.5px; }
        .placeholder-hints {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          margin-top: 22px;
        }
        .placeholder-hints .meta-chip { background: #f3f6ef; }

        .loading {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          text-align: center;
          padding: 56px 30px;
          color: var(--muted);
          font-size: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          box-shadow: 0 10px 30px rgba(31,42,36,0.06);
        }
        .loading .big-spinner {
          width: 42px; height: 42px;
          border: 3px solid rgba(0,200,83,0.2);
          border-top-color: var(--brand-dark);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .results-container {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 30px;
          box-shadow: 0 10px 30px rgba(31,42,36,0.06);
          animation: fadeUp 0.5s ease both;
        }

        .results-header {
          margin-bottom: 20px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--border);
        }

        .results-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 12px;
        }

        .results-meta { display: flex; flex-wrap: wrap; gap: 8px; }
        .meta-chip {
          font-size: 12.5px;
          color: var(--brand-darker);
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.3);
          padding: 5px 12px;
          border-radius: 999px;
          font-weight: 600;
        }

        .table-container { overflow-x: auto; border-radius: 12px; }

        .results-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          margin-top: 6px;
        }

        .results-table th {
          background: #f6f9f2;
          font-weight: 700;
          color: var(--muted);
          text-transform: uppercase;
          font-size: 11.5px;
          letter-spacing: 0.06em;
          padding: 13px 14px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .results-table td {
          padding: 14px;
          text-align: left;
          border-bottom: 1px solid #eef1ec;
          color: var(--text);
          font-size: 14px;
          vertical-align: top;
        }

        .results-table tbody tr.row-main { transition: background 0.15s; }
        .results-table tbody tr.row-main:hover { background: #f7faf3; }

        .cat-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid transparent;
          text-transform: capitalize;
        }
        .category-positive { color: #1f8a4c; background: #e6f6ec; border-color: #b7e4c7; }
        .category-negative { color: #c0392b; background: #fdecea; border-color: #f5c2be; }
        .category-edge { color: #b8860b; background: #fcf3d9; border-color: #f0dca0; }
        .category-authorization { color: #7d3cc0; background: #f3e9fb; border-color: #ddc6f2; }
        .category-non-functional { color: #2b6cb0; background: #e7f0fa; border-color: #c0d8f0; }
        .category-functional { color: #1f8a4c; background: #e6f6ec; border-color: #b7e4c7; }
        .category-boundary { color: #a14d00; background: #fdefe2; border-color: #f3cfa8; }
        .category-edge-case { color: #8a6a00; background: #fcf3d9; border-color: #f0dca0; }
        .category-ui { color: #0b6e79; background: #e2f5f7; border-color: #b0e0e6; }
        .category-accessibility { color: #2b5cb0; background: #e7eefa; border-color: #c0d0f0; }
        .category-security { color: #7d3cc0; background: #f3e9fb; border-color: #ddc6f2; }
        .category-usability { color: #b02a6b; background: #fbe9f2; border-color: #f2c4da; }

        /* ---------- Category pills ---------- */
        .label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .label-row .form-label { margin-bottom: 0; }
        .link-btn.select-all { color: var(--brand-darker); }
        .link-btn.select-all:hover { color: var(--brand-dark); }
        .category-pills { display: flex; flex-wrap: wrap; gap: 8px; }
        .cat-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 13px;
          border-radius: 999px;
          border: 1px solid transparent;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s, filter 0.15s;
        }
        /* Unselected pills are neutral; selected ones are plain black */
        .cat-pill:not(.active) { background: #fbfdfa; color: var(--muted); border-color: var(--border); }
        .cat-pill:not(.active):hover { border-color: #111; color: var(--text); }
        .cat-pill.active { background: #111; color: #fff; border-color: #111; }
        .cat-pill.active:hover { background: #333; border-color: #333; }
        .cat-pill:active { transform: scale(0.97); }
        .cat-pill:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0,200,83,0.3); }
        .cat-pill.active { font-weight: 700; }
        .cat-pill-icon { font-size: 12px; width: 14px; text-align: center; }
        .count-hint.hint-error { color: #b3261e; }

        .test-case-id {
          cursor: pointer;
          color: var(--brand-darker);
          font-weight: 700;
          padding: 6px 10px;
          border-radius: 8px;
          transition: background-color 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .test-case-id:hover { background: var(--brand-soft); }
        .test-case-id.expanded { background: var(--brand-soft); }

        .expand-icon {
          font-size: 9px;
          transition: transform 0.2s;
          color: var(--muted);
        }
        .expand-icon.expanded { transform: rotate(90deg); color: var(--brand-dark); }

        .expanded-details {
          margin-top: 8px;
          background: #f8faf5;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px;
          animation: fadeUp 0.3s ease both;
        }

        .details-title { margin-bottom: 16px; color: var(--text); font-size: 15px; font-weight: 700; }

        .step-item {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 10px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .step-item:hover {
          border-color: var(--brand);
          box-shadow: 0 4px 12px rgba(0,200,83,0.15);
        }

        .step-header {
          display: grid;
          grid-template-columns: 70px 1fr 1fr 1fr;
          gap: 15px;
          align-items: start;
        }

        .step-id {
          font-weight: 700;
          color: #fff;
          background: linear-gradient(120deg, var(--brand), var(--brand-dark));
          padding: 5px 8px;
          border-radius: 8px;
          text-align: center;
          font-size: 12px;
        }
        .step-description { color: var(--text); line-height: 1.5; font-size: 13.5px; }
        .step-test-data { color: var(--muted); font-style: italic; font-size: 13px; }
        .step-expected { color: #1f8a4c; font-weight: 500; font-size: 13px; }

        .step-labels {
          display: grid;
          grid-template-columns: 70px 1fr 1fr 1fr;
          gap: 15px;
          margin-bottom: 12px;
          font-weight: 700;
          color: var(--muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        /* ---------- AI engine + Jira panels ---------- */
        .panel {
          background: #f8fbf6;
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px 16px;
          margin-bottom: 16px;
        }
        .panel-warn { background: #fff8e6; border-color: #f0dca0; }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }
        .panel-title {
          font-weight: 700;
          font-size: 13.5px;
          color: var(--text);
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .panel-note { font-size: 12.5px; color: var(--muted); margin-bottom: 10px; word-break: break-all; }
        .panel-note a { color: var(--brand-darker); }
        .panel code, .modal code {
          background: #eef3ea;
          padding: 1px 5px;
          border-radius: 5px;
          font-size: 12px;
        }

        .field-row { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; }
        @media (max-width: 480px) { .field-row { grid-template-columns: 1fr; } }
        .field { margin-top: 8px; min-width: 0; }
        .field:first-child { margin-top: 0; }
        .field-row .field { margin-top: 0; }
        .field-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
        }

        .form-select {
          width: 100%;
          padding: 10px 34px 10px 12px;
          border: 1px solid var(--border);
          border-radius: 10px;
          font-size: 13.5px;
          color: var(--text);
          background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%236b7a72' stroke-width='1.6' d='M1 1l5 5 5-5'/%3E%3C/svg%3E") no-repeat right 12px center;
          appearance: none;
          font-family: inherit;
          cursor: pointer;
          text-overflow: ellipsis;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .form-select:focus {
          outline: none;
          border-color: var(--brand);
          box-shadow: 0 0 0 4px rgba(0,200,83,0.18);
        }
        .form-select:disabled { background-color: #f2f4f0; cursor: not-allowed; color: var(--muted); }
        .form-input.compact { padding: 8px 12px; margin-bottom: 6px; font-size: 13px; }

        .toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
        .toggle input { position: absolute; opacity: 0; pointer-events: none; }
        .toggle-track {
          width: 34px; height: 20px; border-radius: 999px;
          background: #cfd8cb; position: relative; transition: background 0.2s;
        }
        .toggle-thumb {
          position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
          border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          transition: transform 0.2s;
        }
        .toggle input:checked + .toggle-track { background: var(--brand); }
        .toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(14px); }
        .toggle input:focus-visible + .toggle-track { box-shadow: 0 0 0 3px rgba(0,200,83,0.3); }
        .toggle-label { font-size: 12.5px; font-weight: 600; color: var(--text); }
        .toggle-disabled { opacity: 0.5; cursor: not-allowed; }

        .jira-btn {
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 11px 16px;
          border-radius: 11px;
          border: 1px solid #b3d4ff;
          background: #f0f6ff;
          color: #0747a6;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
          font-family: inherit;
        }
        .jira-btn:hover:not(:disabled) {
          background: #e3efff;
          box-shadow: 0 6px 16px rgba(38,132,255,0.2);
          transform: translateY(-1px);
        }
        .jira-btn:disabled { opacity: 0.7; cursor: wait; }

        .status-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--brand); box-shadow: 0 0 8px var(--brand);
        }
        .link-btn {
          background: none; border: none; color: var(--muted);
          font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .link-btn:hover { color: #b3261e; text-decoration: underline; }

        .inline-error {
          background: #fdeceb;
          border: 1px solid #f5c2be;
          color: #b3261e;
          font-size: 12.5px;
          padding: 8px 12px;
          border-radius: 9px;
          margin-bottom: 10px;
        }
        .story-loaded {
          margin-top: 10px;
          font-size: 12.5px;
          color: var(--brand-darker);
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.3);
          border-radius: 9px;
          padding: 8px 12px;
        }
        .story-loaded a { color: var(--brand-darker); font-weight: 700; }
        .story-warn { color: #8a6100; margin-top: 4px; }

        .btn-spinner.dark { border-color: rgba(7,71,166,0.25); border-top-color: #0747a6; }
        .btn-spinner.small { width: 11px; height: 11px; border-width: 2px; }

        .switch-notice {
          margin-top: 14px;
          background: #fff8e6;
          border: 1px solid #f0dca0;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 12.5px;
          color: #6b5200;
        }
        .switch-notice ul { list-style: none; margin-top: 6px; }
        .switch-notice li { padding: 2px 0; }
        .switch-notice li.ok { color: #1f8a4c; font-weight: 600; }
        .switch-notice .reason { color: var(--muted); font-weight: 400; }

        /* ---------- Test case count picker ---------- */
        .count-group { margin-top: 16px; }
        .count-picker { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .count-chip {
          min-width: 48px;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: #fbfdfa;
          color: var(--text);
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .count-chip:hover { border-color: var(--brand); }
        .count-chip.active {
          background: var(--brand-soft);
          border-color: var(--brand);
          color: var(--brand-darker);
        }
        .form-input.count-input { width: 96px; padding: 8px 12px; border-radius: 999px; font-size: 13px; }
        .form-input.count-input.active { border-color: var(--brand); background: var(--brand-soft); }
        .count-hint { font-size: 12px; color: var(--muted); margin-top: 6px; }

        /* ---------- Results summary ---------- */
        .summary-card {
          background: linear-gradient(180deg, #f6fbf3, #fbfdfa);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 16px 18px;
          margin-bottom: 20px;
        }
        .summary-title { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
        .summary-text { font-size: 14px; color: var(--text); line-height: 1.6; margin-bottom: 14px; }
        .summary-stats { display: flex; flex-wrap: wrap; gap: 10px; }
        .stat {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px 14px;
          min-width: 96px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
        .stat-value { font-size: 1.35rem; font-weight: 800; color: var(--text); line-height: 1.1; }
        .stat-label { font-size: 12px; color: var(--muted); font-weight: 600; }

        /* ---------- Modal ---------- */
        .modal-backdrop {
          position: fixed; inset: 0;
          background: rgba(20, 30, 24, 0.45);
          backdrop-filter: blur(3px);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
          z-index: 100;
          animation: fadeUp 0.2s ease both;
        }
        .modal {
          width: 100%;
          max-width: 440px;
          background: var(--surface);
          border-radius: 18px;
          padding: 26px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.25);
        }
        .modal-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .modal-header h3 { font-size: 1.2rem; font-weight: 800; }
        .modal-sub { font-size: 13px; color: var(--muted); margin-bottom: 18px; }
        .modal-actions { display: flex; gap: 10px; margin-top: 20px; }
        .modal-actions .modal-submit { margin-top: 0; flex: 1; }
        .secondary-btn {
          padding: 12px 20px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: #fff;
          color: var(--text);
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .secondary-btn:hover:not(:disabled) { background: #f4f7f3; }
      `}</style>

      {authChecking ? (
        <main className="login-page">
          <div className="login-topbar">{themeToggle}</div>
          <section className="login-card" aria-live="polite">Checking your sign-in…</section>
        </main>
      ) : !isAuthenticated ? (
        <main className="login-page">
          <div className="login-topbar">{themeToggle}</div>
          <section className="login-card" aria-labelledby="login-title">
            <div className="login-brand" aria-hidden="true">🧪</div>
            <div className="login-eyebrow">AI-powered QA workspace</div>
            <h1 id="login-title" className="login-title">Welcome back</h1>
            <p className="login-description">Sign in to turn your user stories into clear, comprehensive test cases.</p>
            <form className="login-form" onSubmit={handleLoginSubmit}>
              <div className="form-group">
                <label htmlFor="loginEmail" className="form-label">Email address</label>
                <input
                  id="loginEmail"
                  className="form-input"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="username"
                  value={loginEmail}
                  onChange={event => setLoginEmail(event.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="loginPassword" className="form-label">Password</label>
                <input
                  id="loginPassword"
                  className="form-input"
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={event => setLoginPassword(event.target.value)}
                  required
                />
              </div>
              {loginError && <div className="inline-error" role="alert">{loginError}</div>}
              <button
                type="submit"
                className="submit-btn login-submit"
                disabled={isSigningIn || authConfigured !== true}
              >
                {isSigningIn && <span className="btn-spinner" />}
                {isSigningIn ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="login-footnote">Your password is verified by the server and is never stored in the browser.</p>
          </section>
        </main>
      ) : (
      <>
      <div className="container">
        <div className="header">
          <span className="badge-pill">
            <span className="badge-dot"></span>
            AI-Powered Test Generation
          </span>
          <h1 className="title">User Story to <span className="accent">Tests</span></h1>
          <p className="subtitle">Turn user stories into comprehensive, structured test cases in seconds.</p>
          <div className="app-header-tools">
            {themeToggle}
            <button type="button" className="sign-out-btn" onClick={handleSignOut}>Sign out</button>
          </div>
        </div>

        <div className="workspace">
          <form onSubmit={handleSubmit} className="form-container">
            {configError && <div className="inline-error">{configError}</div>}

            {/* Row 1: AI engine + Jira side by side */}
            <div className="form-row panels-row">
              {config && (
                <ModelSelector
                  providers={config.providers}
                  provider={provider}
                  model={model}
                  autoSwitch={autoSwitch}
                  onProviderChange={handleProviderChange}
                  onModelChange={setModel}
                  onAutoSwitchChange={setAutoSwitch}
                />
              )}

              {config?.jira.enabled && (
                <div>
                  <JiraPanel
                    onStorySelected={handleStorySelected}
                    onExportContextChange={setJiraExportContext}
                  />
                </div>
              )}
            </div>

            {/* Row 2: story title (full width) */}
            <div className="form-group">
              <label htmlFor="storyTitle" className="form-label">
                Story Title <span className="req">*</span>
              </label>
              <input
                type="text"
                id="storyTitle"
                className="form-input"
                value={formData.storyTitle}
                onChange={(e) => handleInputChange('storyTitle', e.target.value)}
                placeholder="Enter the user story title..."
                required
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
            </div>

            {/* Row 3: description | acceptance criteria | additional info */}
            <div className="form-row cols-3">
            <div className="form-group">
              <label htmlFor="description" className="form-label">
                Description
              </label>
              <textarea
                id="description"
                className="form-textarea tall"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="Additional description (optional)..."
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
            </div>

            <div className="form-group">
              <label htmlFor="acceptanceCriteria" className="form-label">
                Acceptance Criteria <span className="req">*</span>
              </label>
              <textarea
                id="acceptanceCriteria"
                className="form-textarea tall"
                value={formData.acceptanceCriteria}
                onChange={(e) => handleInputChange('acceptanceCriteria', e.target.value)}
                placeholder="Enter the acceptance criteria..."
                required
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
            </div>

            <div className="form-group">
              <label htmlFor="additionalInfo" className="form-label">
                Additional Info
              </label>
              <textarea
                id="additionalInfo"
                className="form-textarea tall"
                value={formData.additionalInfo}
                onChange={(e) => handleInputChange('additionalInfo', e.target.value)}
                placeholder="Any additional information (optional)..."
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
            </div>
            </div>

            {/* Row 4: categories | count | generate */}
            <div className="form-row options-row">
            <div className="form-group count-group">
              <div className="label-row">
                <span className="form-label">
                  Test Categories <span className="req">*</span>
                </span>
                <button
                  type="button"
                  className="link-btn select-all"
                  onClick={() => setSelectedCategories(allCategoriesSelected ? [] : [...CATEGORY_ORDER])}
                >
                  {allCategoriesSelected ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="category-pills" role="group" aria-label="Test categories">
                {TEST_CATEGORIES.map(c => {
                  const active = selectedCategories.includes(c.name)
                  return (
                    <button
                      key={c.name}
                      type="button"
                      className={`cat-pill ${active ? 'active' : ''}`}
                      aria-pressed={active}
                      title={c.hint}
                      onClick={() => toggleCategory(c.name)}
                    >
                      <span className="cat-pill-icon" aria-hidden="true">{active ? '✓' : c.icon}</span>
                      {c.name}
                    </button>
                  )
                })}
              </div>
              <div className={`count-hint ${selectedCategories.length === 0 ? 'hint-error' : ''}`}>
                {selectedCategories.length === 0
                  ? 'Select at least one category.'
                  : `${selectedCategories.length} of ${CATEGORY_ORDER.length} selected. Test cases will be generated only for these.`}
              </div>
            </div>

            <div className="form-group count-group">
              <label htmlFor="testCaseCount" className="form-label">
                Number of Test Cases
              </label>
              <div className="count-picker">
                <button
                  type="button"
                  className={`count-chip ${testCaseCount === '' ? 'active' : ''}`}
                  onClick={() => setTestCaseCount('')}
                >
                  Auto
                </button>
                {COUNT_PRESETS.map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`count-chip ${testCaseCount === String(n) ? 'active' : ''}`}
                    onClick={() => setTestCaseCount(String(n))}
                  >
                    {n}
                  </button>
                ))}
                <input
                  id="testCaseCount"
                  type="number"
                  min={1}
                  max={MAX_TEST_CASES}
                  inputMode="numeric"
                  className={`form-input count-input ${isCustomCount ? 'active' : ''}`}
                  placeholder="Custom"
                  value={isCustomCount ? testCaseCount : ''}
                  onChange={e => setTestCaseCount(e.target.value)}
                />
              </div>
              <div className="count-hint">
                {testCaseCount === '' ? 'AI decides how many test cases are needed.' : `Generates exactly ${testCaseCount} test case(s) (max ${MAX_TEST_CASES}).`}
              </div>
            </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="submit-btn"
                disabled={isLoading || (config !== null && config.providers.length === 0)}
              >
                {isLoading && <span className="btn-spinner"></span>}
                {isLoading ? 'Generating...' : '✨ Generate Test Cases'}
              </button>
            </div>
          </form>

          <div className="output-col" ref={outputRef}>
              {error && (
                <div className="error-banner">
                  <span>⚠️</span>
                  {error}
                </div>
              )}

              {isLoading && (
                <div className="loading">
                  <span className="big-spinner"></span>
                  Generating test cases...
                </div>
              )}

              {!isLoading && !results && !error && (
                <div className="placeholder-card">
                  <div className="placeholder-icon">🧪</div>
                  <div className="placeholder-title">Your test cases will appear here</div>
                  <p className="placeholder-text">
                    Fill in the story details above and hit Generate. We'll craft
                    positive, negative, edge, and more test cases for you.
                  </p>
                  <div className="placeholder-hints">
                    {selectedCategories.map(c => (
                      <span key={c} className="meta-chip">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {!isLoading && results && (
                <div className="results-container">
                  <div className="results-header">
                    <h2 className="results-title">Generated Test Cases</h2>
                    <div className="results-meta">
                      <span className="meta-chip">{results.cases.length} test case(s)</span>
                      {results.providerName && <span className="meta-chip">Provider: {results.providerName}</span>}
                      {results.model && <span className="meta-chip">Model: {results.model}</span>}
                      {results.promptTokens > 0 && (
                        <span className="meta-chip">Tokens: {results.promptTokens + results.completionTokens}</span>
                      )}
                    </div>
                    {results.attempts && results.attempts.length > 1 && (
                      <div className="switch-notice">
                        <strong>🔁 Auto-switched model.</strong>
                        <ul>
                          {results.attempts.map((a, i) => (
                            <li key={i} className={a.ok ? 'ok' : 'fail'}>
                              {a.ok ? '✅' : '❌'} {a.providerName} / {a.model}
                              {a.reason && <span className="reason"> — {a.reason}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="summary-card">
                    <div className="summary-title">📋 Summary</div>
                    {results.summary && <p className="summary-text">{results.summary}</p>}
                    <div className="summary-stats">
                      <div className="stat">
                        <div className="stat-value">{results.cases.length}</div>
                        <div className="stat-label">
                          Total{results.requestedCount ? ` / ${results.requestedCount} requested` : ''}
                        </div>
                      </div>
                      {categoryCounts(results.cases).map(([cat, n]) => (
                        <div key={cat} className="stat">
                          <div className="stat-value">{n}</div>
                          <span className={`cat-badge ${categoryClass(cat)}`}>{cat}</span>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const covered = new Set(results.cases.map(c => c.category))
                      const missing = (results.requestedCategories || []).filter(c => !covered.has(c))
                      return missing.length > 0 ? (
                        <div className="story-warn">Not covered: {missing.join(', ')}</div>
                      ) : null
                    })()}
                    {results.requestedCount && results.cases.length < results.requestedCount && (
                      <div className="story-warn">
                        The model returned fewer test cases than requested. Try again or pick another model.
                      </div>
                    )}
                  </div>

                  <div className="approval-toolbar">
                    <div>
                      <div className="approval-toolbar-title">Review and approve</div>
                      <div className="approval-toolbar-note">
                        {selectedTestCaseCount} selected · {approvalDestination === 'jira'
                          ? 'adds a comment to the selected Jira story and moves it to In Progress.'
                          : 'creates AIO test cases linked to the selected Jira story.'}
                      </div>
                    </div>
                    <div className="approval-actions">
                      <button
                        type="button"
                        className="approval-link-btn"
                        onClick={handleSelectAllTestCases}
                        disabled={availableTestCaseIds.length === 0 || isApprovingTestCases}
                      >
                        {allAvailableTestCasesSelected ? 'Clear selection' : 'Select all'}
                      </button>
                      <select
                        className="form-select approval-destination-select"
                        aria-label="Approval destination"
                        value={approvalDestination}
                        onChange={event => {
                          const destination = event.currentTarget.value
                          if (destination !== 'jira' && destination !== 'aio') return
                          setApprovalDestination(destination)
                          setJiraApprovalResult(null)
                          setAioApprovalResult(null)
                          setApprovalError(null)
                        }}
                        disabled={isApprovingTestCases}
                      >
                        <option value="jira">Jira API</option>
                        <option value="aio">AIO Tests</option>
                      </select>
                      <button
                        type="button"
                        className="submit-btn"
                        onClick={handleApproveTestCases}
                        disabled={
                          isApprovingTestCases ||
                          selectedTestCaseCount === 0 ||
                          !jiraExportContext.credentials ||
                          !jiraExportContext.projectKey ||
                          !selectedJiraStoryKey ||
                          (approvalDestination === 'aio' && !config?.aioTests?.enabled)
                        }
                      >
                        {isApprovingTestCases && <span className="btn-spinner" />}
                        {isApprovingTestCases ? 'Approving…' : approvalDestination === 'aio' ? 'Approve in AIO Tests' : 'Approve Test Cases'}
                      </button>
                    </div>
                  </div>
                  {(!jiraExportContext.credentials || !selectedJiraStoryKey) && (
                    <div className="count-hint">Connect to Jira and select the Jira story these test cases belong to.</div>
                  )}
                  {jiraExportContext.credentials && selectedJiraStoryKey && approvalDestination === 'aio' && !config?.aioTests?.enabled && (
                    <div className="count-hint">
                      Configure <code>AIO_TESTS_API_BASE_URL</code> and <code>AIO_TESTS_API_TOKEN</code> in the backend <code>.env</code>, then restart the backend to enable AIO Tests.
                    </div>
                  )}
                  {approvalError && <div className="inline-error approval-status" role="alert">{approvalError}</div>}
                  {jiraApprovalResult && (
                    <div className="approval-status approval-success" role="status">
                      Added the selected test cases as a comment on{' '}
                      <a href={jiraApprovalResult.issueUrl} target="_blank" rel="noreferrer">{jiraApprovalResult.issueKey}</a>.
                      {' '}
                      {jiraApprovalResult.statusAlreadyInProgress
                        ? 'The issue was already In Progress.'
                        : jiraApprovalResult.statusTransitioned
                          ? 'Moved the issue to In Progress.'
                          : `Current status: ${jiraApprovalResult.issueStatus}.`}
                    </div>
                  )}
                  {jiraApprovalResult?.statusError && (
                    <div className="approval-status approval-failures" role="alert">
                      The comment was added, but the status could not be moved to In Progress: {jiraApprovalResult.statusError}
                    </div>
                  )}
                  {aioApprovalResult && aioApprovalResult.created.length > 0 && (
                    <div className="approval-status approval-success" role="status">
                      Created {aioApprovalResult.created.length} AIO test case(s) linked to{' '}
                      <a href={`${jiraExportContext.credentials?.baseUrl}/browse/${aioApprovalResult.issueKey}`} target="_blank" rel="noreferrer">
                        {aioApprovalResult.issueKey}
                      </a>
                      : {aioApprovalResult.created.map(testCase => testCase.key).join(', ')}.
                    </div>
                  )}
                  {aioApprovalResult && aioApprovalResult.failures.length > 0 && (
                    <div className="approval-status approval-failures" role="alert">
                      Could not confirm {aioApprovalResult.failures.length} case(s) in AIO Tests:
                      <ul>
                        {aioApprovalResult.failures.map(failure => (
                          <li key={failure.testCaseId}>{failure.title}: {failure.error}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="table-container">
                    <table className="results-table">
                      <thead>
                        <tr>
                          <th scope="col">Approve</th>
                          <th>Test Case ID</th>
                          <th>Title</th>
                          <th>Category</th>
                          <th>Expected Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.cases.map((testCase: TestCase) => (
                          <Fragment key={testCase.id}>
                            <tr className="row-main">
                              <td>
                                <input
                                  type="checkbox"
                                  className="approval-checkbox"
                                  aria-label={approvedTestCaseIds.has(testCase.id)
                                    ? `${testCase.id} already added to Jira`
                                    : `Select ${testCase.id} for approval`}
                                  checked={approvedTestCaseIds.has(testCase.id) || selectedTestCases.has(testCase.id)}
                                  disabled={approvedTestCaseIds.has(testCase.id) || isApprovingTestCases}
                                  onChange={() => toggleTestCaseApproval(testCase.id)}
                                />
                              </td>
                              <td>
                                <div
                                  className={`test-case-id ${expandedTestCases.has(testCase.id) ? 'expanded' : ''}`}
                                  onClick={() => toggleTestCaseExpansion(testCase.id)}
                                >
                                  <span className={`expand-icon ${expandedTestCases.has(testCase.id) ? 'expanded' : ''}`}>
                                    ▶
                                  </span>
                                  {testCase.id}
                                </div>
                              </td>
                              <td>{testCase.title}</td>
                              <td>
                                <span className={`cat-badge ${categoryClass(testCase.category)}`}>
                                  {testCase.category}
                                </span>
                              </td>
                              <td>{testCase.expectedResult}</td>
                            </tr>
                            {expandedTestCases.has(testCase.id) && (
                              <tr key={`${testCase.id}-details`}>
                                <td colSpan={5}>
                                  <div className="expanded-details">
                                    <h4 className="details-title">Test Steps for {testCase.id}</h4>
                                    <div className="step-labels">
                                      <div>Step ID</div>
                                      <div>Step Description</div>
                                      <div>Test Data</div>
                                      <div>Expected Result</div>
                                    </div>
                                    {testCase.steps.map((step, index) => (
                                      <div key={index} className="step-item">
                                        <div className="step-header">
                                          <div className="step-id">S{String(index + 1).padStart(2, '0')}</div>
                                          <div className="step-description">{step}</div>
                                          <div className="step-test-data">{testCase.testData || 'N/A'}</div>
                                          <div className="step-expected">
                                            {index === testCase.steps.length - 1 ? testCase.expectedResult : 'Step completed successfully'}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
        </div>
      </div>
      </>
      )}
    </div>
  )
}

export default App
