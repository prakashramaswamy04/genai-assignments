import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { connectJira, getJiraProjects, getJiraStories } from '../api'
import { JiraCredentials, JiraProject, JiraStory } from '../types'

const STORAGE_KEY = 'jira-connection'

interface Props {
  onStorySelected: (story: JiraStory | null) => void
  onExportContextChange: (context: { credentials: JiraCredentials | null; projectKey: string }) => void
}

function loadSaved(): JiraCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function save(creds: JiraCredentials | null) {
  try {
    if (creds) localStorage.setItem(STORAGE_KEY, JSON.stringify(creds))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable – ignore */
  }
}

export function JiraPanel({ onStorySelected, onExportContextChange }: Props) {
  const saved = loadSaved()
  const [showModal, setShowModal] = useState(false)
  const [email, setEmail] = useState(saved?.email || '')
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl || '')

  const [creds, setCreds] = useState<JiraCredentials | null>(null)
  const [userName, setUserName] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const [projects, setProjects] = useState<JiraProject[]>([])
  const [projectKey, setProjectKey] = useState('')
  const [stories, setStories] = useState<JiraStory[]>([])
  const [storyKey, setStoryKey] = useState('')
  const [storyFilter, setStoryFilter] = useState('')
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingStories, setLoadingStories] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doConnect = async (c: JiraCredentials, silent = false) => {
    setConnecting(true)
    setConnectError(null)
    try {
      const result = await connectJira(c)
      const normalized = { email: c.email.trim(), baseUrl: result.baseUrl }
      setCreds(normalized)
      onStorySelected(null)
      setBaseUrl(result.baseUrl)
      setUserName(result.user.displayName)
      onExportContextChange({ credentials: normalized, projectKey: '' })
      save(normalized)
      setShowModal(false)
      loadProjects(normalized)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to Jira'
      if (silent) {
        setError(`Saved Jira connection failed: ${msg}`)
      } else {
        setConnectError(msg)
      }
    } finally {
      setConnecting(false)
    }
  }

  // Auto-reconnect with saved email/URL (the API token always stays on the server)
  useEffect(() => {
    if (saved?.email && saved?.baseUrl) doConnect(saved, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProjects = async (c: JiraCredentials) => {
    setLoadingProjects(true)
    setError(null)
    try {
      setProjects(await getJiraProjects(c))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoadingProjects(false)
    }
  }

  const handleProjectChange = async (key: string) => {
    setProjectKey(key)
    onStorySelected(null)
    onExportContextChange({ credentials: creds, projectKey: key })
    setStories([])
    setStoryKey('')
    setStoryFilter('')
    if (!key || !creds) return
    setLoadingStories(true)
    setError(null)
    try {
      setStories(await getJiraStories(creds, key))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stories')
    } finally {
      setLoadingStories(false)
    }
  }

  const handleStoryChange = (key: string) => {
    setStoryKey(key)
    const story = stories.find(s => s.key === key)
    onStorySelected(story || null)
  }

  const disconnect = () => {
    onStorySelected(null)
    onExportContextChange({ credentials: null, projectKey: '' })
    save(null)
    setCreds(null)
    setUserName('')
    setProjects([])
    setProjectKey('')
    setStories([])
    setStoryKey('')
    setError(null)
  }

  const filteredStories = useMemo(() => {
    const q = storyFilter.trim().toLowerCase()
    if (!q) return stories
    return stories.filter(s => s.key.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q))
  }, [stories, storyFilter])

  const selectedStory = stories.find(s => s.key === storyKey)

  return (
    <>
      {!creds ? (
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">🔗 Jira</div>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <button
            type="button"
            className="jira-btn"
            onClick={() => { setConnectError(null); setShowModal(true) }}
            disabled={connecting}
          >
            {connecting ? <span className="btn-spinner dark" /> : <JiraIcon />}
            {connecting ? 'Connecting…' : 'Connect to Jira'}
          </button>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="status-dot" /> Jira connected
            </div>
            <button type="button" className="link-btn" onClick={disconnect}>Disconnect</button>
          </div>
          <div className="panel-note">
            {userName} · <a href={creds.baseUrl} target="_blank" rel="noreferrer">{creds.baseUrl.replace(/^https?:\/\//, '')}</a>
          </div>

          {error && <div className="inline-error">{error}</div>}

          <div className="field">
            <label htmlFor="jiraProject" className="field-label">Project</label>
            <select
              id="jiraProject"
              className="form-select"
              value={projectKey}
              onChange={e => handleProjectChange(e.target.value)}
              disabled={loadingProjects}
            >
              <option value="">{loadingProjects ? 'Loading projects…' : `Select a project (${projects.length})`}</option>
              {projects.map(p => (
                <option key={p.id} value={p.key}>{p.name} ({p.key})</option>
              ))}
            </select>
          </div>

          {projectKey && (
            <div className="field">
              <label htmlFor="jiraStory" className="field-label">
                Story {loadingStories && <span className="btn-spinner dark small" />}
              </label>
              {stories.length > 10 && (
                <input
                  type="text"
                  className="form-input compact"
                  placeholder="Filter stories by key or title…"
                  value={storyFilter}
                  onChange={e => setStoryFilter(e.target.value)}
                />
              )}
              <select
                id="jiraStory"
                className="form-select"
                value={storyKey}
                onChange={e => handleStoryChange(e.target.value)}
                disabled={loadingStories || stories.length === 0}
              >
                <option value="">
                  {loadingStories
                    ? 'Loading stories…'
                    : stories.length === 0
                      ? 'No stories found in this project'
                      : `Select a story (${filteredStories.length})`}
                </option>
                {filteredStories.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.key} — {s.summary}{s.status ? ` [${s.status}]` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedStory && (
            <div className="story-loaded">
              ✅ Loaded <a href={selectedStory.url} target="_blank" rel="noreferrer">{selectedStory.key}</a> into the form
              {!selectedStory.acceptanceCriteria && (
                <div className="story-warn">No acceptance criteria found in Jira — please add them below.</div>
              )}
            </div>
          )}
        </div>
      )}

      {showModal && createPortal(
        <div className="modal-backdrop" onClick={() => !connecting && setShowModal(false)}>
          <form
            className="modal"
            onClick={e => e.stopPropagation()}
            onSubmit={e => {
              e.preventDefault()
              e.stopPropagation() // don't trigger the outer "Generate" form
              doConnect({ email, baseUrl })
            }}
          >
            <div className="modal-header">
              <JiraIcon size={22} />
              <h3>Connect to Jira</h3>
            </div>
            <p className="modal-sub">
              The Jira API token is read securely from the server's <code>.env</code> file. Enter the email of the
              Atlassian account the token belongs to and your Jira URL.
            </p>

            <div className="form-group">
              <label htmlFor="jiraEmail" className="form-label">Email ID <span className="req">*</span></label>
              <input
                id="jiraEmail"
                type="email"
                className="form-input"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="jiraUrl" className="form-label">Jira Endpoint URL <span className="req">*</span></label>
              <input
                id="jiraUrl"
                type="text"
                className="form-input"
                placeholder="https://your-company.atlassian.net"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                required
              />
            </div>

            {connectError && <div className="inline-error">{connectError}</div>}

            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setShowModal(false)} disabled={connecting}>
                Cancel
              </button>
              <button type="submit" className="submit-btn modal-submit" disabled={connecting || !email || !baseUrl}>
                {connecting && <span className="btn-spinner" />}
                {connecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </>
  )
}

function JiraIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#2684FF" d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53Z" />
      <path fill="#2684FF" opacity=".8" d="M6.77 6.8a4.36 4.36 0 0 0 4.34 4.34h1.8v1.72a4.36 4.36 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77Z" />
      <path fill="#2684FF" opacity=".6" d="M2 11.6c0 2.4 1.95 4.34 4.35 4.34h1.78v1.72c.01 2.39 1.95 4.33 4.34 4.34v-9.57a.84.84 0 0 0-.84-.84H2Z" />
    </svg>
  )
}
