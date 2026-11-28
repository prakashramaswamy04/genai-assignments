import { ProviderInfo } from '../types'

interface Props {
  providers: ProviderInfo[]
  provider: string
  model: string
  autoSwitch: boolean
  onProviderChange: (providerId: string) => void
  onModelChange: (model: string) => void
  onAutoSwitchChange: (value: boolean) => void
}

export function ModelSelector({
  providers,
  provider,
  model,
  autoSwitch,
  onProviderChange,
  onModelChange,
  onAutoSwitchChange
}: Props) {
  if (providers.length === 0) {
    return (
      <div className="panel panel-warn">
        <div className="panel-title">⚙️ AI Engine</div>
        <p className="panel-note">
          No LLM API key found. Add <code>GROQ_API_KEY</code> and/or <code>INCEPTION_API_KEY</code> to the
          root <code>.env</code> file and restart the backend.
        </p>
      </div>
    )
  }

  const current = providers.find(p => p.id === provider) || providers[0]
  const canSwitch = providers.length > 1 || current.models.length > 1

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">⚙️ AI Engine</div>
        <label className={`toggle ${!canSwitch ? 'toggle-disabled' : ''}`} title="When the selected model hits a rate limit, runs out of quota or fails, automatically try the next available model/provider.">
          <input
            type="checkbox"
            checked={autoSwitch && canSwitch}
            disabled={!canSwitch}
            onChange={e => onAutoSwitchChange(e.target.checked)}
          />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <span className="toggle-label">Auto-switch</span>
        </label>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="provider" className="field-label">Provider</label>
          <select
            id="provider"
            className="form-select"
            value={current.id}
            onChange={e => onProviderChange(e.target.value)}
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="model" className="field-label">Model</label>
          <select
            id="model"
            className="form-select"
            value={model || current.defaultModel}
            onChange={e => onModelChange(e.target.value)}
            disabled={current.models.length === 0}
          >
            {current.models.length === 0 && <option value="">No models available</option>}
            {current.models.map(m => (
              <option key={m} value={m}>
                {m}{m === current.defaultModel ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      {current.error && (
        <div className="inline-error" style={{ marginTop: 10, marginBottom: 0 }}>
          {current.name}: {current.error}
        </div>
      )}
    </div>
  )
}
