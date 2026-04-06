import { useState, useEffect } from 'react'
import { MainPanel } from './components/MainPanel'
import { SetupPanel } from './components/SetupPanel'
import { Loader2 } from 'lucide-react'
import { getConfig } from './lib/api'
import './index.css'

type Tab = 'assistant' | 'setup'

export interface AppConfig {
  api_key: string
  window_alpha: number
  microphone_device_index: number
  transcription_mode: string
  cv: string
  job_description: string
  system_prompt: string
  user_prompt: string
}

const DEFAULT_CONFIG: AppConfig = {
  api_key: '',
  window_alpha: 0.96,
  microphone_device_index: 0,
  transcription_mode: 'TR + ENG (Mixed)',
  cv: '',
  job_description: '',
  system_prompt: `You are my real-time interview copilot. answering questions live — speed matters.

Language: Answer in Turkish. Use English for technical terms naturally.

Format:
- 4–6 sentences max. I need to read and speak this in seconds.
- No intro, no filler, no "Harika soru" or "Şöyle açıklayayım".
- Start with the answer. Lead with the strongest point.
- Bullet points ONLY if listing 3+ items side by side.
- Numbers and metrics first, explanation second.

Style:
- First person, natural spoken Turkish cadence.
- Confident but not arrogant.

For technical questions: give a clean textbook-level explanation first.
For "what if" / challenge questions: Acknowledge in one clause, then defend with data.

My background:
--- {cv} ---

Role and job description:
--- {job_description} ---

Golden rule: If my answer can be shorter and still land the point, make it shorter.`,
  user_prompt: `Interviewer's question: "{transcribed_text}". Give me a ready-to-speak answer. Turkish with English technical terms.`,
}

export default function App() {
  const [tab, setTab] = useState<Tab>('assistant')
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [backendReady, setBackendReady] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Starting backend…')

  useEffect(() => {
    type ElectronAPI = {
      onBackendReady: (cb: (r: boolean) => void) => void
      onSetupProgress: (cb: (msg: string) => void) => void
    }
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
    if (api?.onBackendReady) {
      api.onSetupProgress?.((msg) => {
        if (msg === 'SETUP_REQUIRED') setLoadingMsg('First-time setup…')
        else if (msg.startsWith('INSTALLING:')) {
          const parts = msg.split(':')
          setLoadingMsg(`Installing packages (${parts[1]})…`)
        } else if (msg === 'SETUP_DONE') setLoadingMsg('Starting backend…')
        else if (msg === 'ENV_READY') setLoadingMsg('Starting backend…')
      })
      api.onBackendReady((ready) => {
        if (ready) loadConfig()
        else setLoadingMsg('Backend failed to start. Please restart the app.')
      })
    } else {
      // Browser dev mode — poll until backend is up
      pollUntilReady()
    }
  }, [])

  async function pollUntilReady() {
    for (let i = 0; i < 60; i++) {
      try {
        await fetch('http://127.0.0.1:7432/health')
        await loadConfig()
        return
      } catch {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    setLoadingMsg('Could not connect to backend.')
  }

  async function loadConfig() {
    try {
      const saved = await getConfig()
      setConfig((prev) => ({ ...prev, ...saved }))
      setBackendReady(true)
    } catch {
      setTimeout(loadConfig, 1000)
    }
  }

  if (!backendReady) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', gap: 12 }}>
        <div className="titlebar" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44 }} />
        <Loader2 size={28} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13, color: '#555' }}>{loadingMsg}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' }}>
      {/* Title bar */}
      <div
        className="titlebar"
        style={{ height: 44, paddingLeft: 76, paddingRight: 16, display: 'flex', alignItems: 'center', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}
      >
        <span style={{ flex: 1, textAlign: 'center', fontSize: 13, color: '#444', fontWeight: 500, pointerEvents: 'none' }}>
          Interview Assistant
        </span>
        <div className="no-drag" style={{ display: 'flex', gap: 3, background: '#141414', borderRadius: 8, padding: 3 }}>
          {(['assistant', 'setup'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '4px 16px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
                background: tab === t ? '#262626' : 'transparent',
                color: tab === t ? '#e8e8e8' : '#555',
                transition: 'all 0.15s',
              }}
            >
              {t === 'assistant' ? 'Assistant' : 'Setup'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'assistant'
          ? <MainPanel config={config} />
          : <SetupPanel config={config} onSave={setConfig} />
        }
      </div>
    </div>
  )
}
