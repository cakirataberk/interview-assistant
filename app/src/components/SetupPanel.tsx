import { useState, useEffect } from 'react'
import { Save, RefreshCw, Eye, EyeOff, Radio, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import type { AppConfig } from '../App'
import { saveConfig, getDevices } from '../lib/api'

const TRANSCRIPTION_MODES = ['English', 'Türkçe', 'TR + ENG (Mixed)']

const USER_PROMPTS: Record<string, string> = {
  Turkish: 'Interviewer\'s question: "{transcribed_text}". Give me a ready-to-speak answer. Turkish with English technical terms.',
  English: 'Interviewer\'s question: "{transcribed_text}". Give me a ready-to-speak answer in English.',
}

function detectAnswerLang(prompt: string): string {
  return prompt.toLowerCase().includes('turkish') ? 'Turkish' : 'English'
}

type BlackHoleStatus = 'unknown' | 'checking' | 'installed' | 'not_installed' | 'installing' | 'error'

interface Props {
  config: AppConfig
  onSave: (config: AppConfig) => void
}

export function SetupPanel({ config, onSave }: Props) {
  const [local, setLocal] = useState<AppConfig>(config)
  const [showKey, setShowKey] = useState(false)
  const [devices, setDevices] = useState<{ index: number; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [bhStatus, setBhStatus] = useState<BlackHoleStatus>('unknown')
  const [bhLog, setBhLog] = useState('')
  const electron = (window as any).electronAPI

  useEffect(() => { setLocal(config) }, [config])
  useEffect(() => {
    loadDevices()
    checkBlackHole()
    // Listen for install progress
    electron?.onBlackholeProgress?.((data: { status: string; detail: string }) => {
      if (data.status === 'progress' && data.detail) setBhLog(data.detail.slice(-120))
      else if (data.status === 'done') { setBhStatus('installed'); loadDevices() }
      else if (data.status === 'error') { setBhStatus('error'); setBhLog(data.detail) }
    })
  }, [])

  async function loadDevices() {
    try {
      const d = await getDevices()
      setDevices(d)
    } catch { /* ignore */ }
  }

  async function checkBlackHole() {
    if (!electron?.blackholeCheck) return
    setBhStatus('checking')
    const installed = await electron.blackholeCheck()
    setBhStatus(installed ? 'installed' : 'not_installed')
  }

  async function installBlackHole() {
    if (!electron?.blackholeInstall) return
    setBhStatus('installing')
    setBhLog('')
    await electron.blackholeInstall()
  }

  function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setLocal((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveConfig(local as unknown as Record<string, unknown>)
      onSave(local)
      // Apply window settings
      electron?.setOpacity(local.window_alpha)
      setSavedMsg('Saved!')
      setTimeout(() => setSavedMsg(''), 2000)
    } catch (e) {
      setSavedMsg('Save failed')
    }
    setSaving(false)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '14px 16px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760, margin: '0 auto' }}>

        {/* API & Window */}
        <Section title="API & Window">
          <Field label="Gemini API Key">
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={local.api_key}
                onChange={(e) => set('api_key', e.target.value)}
                placeholder="AIza…"
                style={inputStyle}
              />
              <IconBtn onClick={() => setShowKey(!showKey)} title={showKey ? 'Hide' : 'Show'}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </IconBtn>
            </div>
          </Field>

          <Field label={`Window Opacity — ${Math.round(local.window_alpha * 100)}%`}>
            <input
              type="range" min={30} max={100}
              value={Math.round(local.window_alpha * 100)}
              onChange={(e) => set('window_alpha', parseInt(e.target.value) / 100)}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
          </Field>
        </Section>

        {/* Audio */}
        <Section title="Audio">
          <Field label="Transcription Language">
            <select
              value={local.transcription_mode}
              onChange={(e) => set('transcription_mode', e.target.value)}
              style={selectStyle}
            >
              {TRANSCRIPTION_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>

          <Field label="Answer Language">
            <select
              value={detectAnswerLang(local.user_prompt)}
              onChange={(e) => set('user_prompt', USER_PROMPTS[e.target.value])}
              style={selectStyle}
            >
              <option value="Turkish">Türkçe</option>
              <option value="English">English</option>
            </select>
          </Field>

          <Field label="Input Device">
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={local.microphone_device_index}
                onChange={(e) => set('microphone_device_index', parseInt(e.target.value))}
                style={{ ...selectStyle, flex: 1 }}
              >
                {devices.map((d) => (
                  <option key={d.index} value={d.index}>{d.index}: {d.name}</option>
                ))}
                {devices.length === 0 && (
                  <option value={0}>No devices found</option>
                )}
              </select>
              <IconBtn onClick={loadDevices} title="Refresh">
                <RefreshCw size={14} />
              </IconBtn>
            </div>
          </Field>
        </Section>

        {/* Meeting Audio / BlackHole */}
        <Section title="Meeting Audio (Zoom / Meet / Teams)">
          <p style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
            BlackHole is a virtual audio driver that lets this app capture audio from Zoom, Google Meet, or Teams — not just your microphone.
          </p>

          {/* Status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            {bhStatus === 'checking' && <><Loader2 size={14} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} /><span style={{ fontSize: 12, color: '#666' }}>Checking…</span></>}
            {bhStatus === 'installed' && <><CheckCircle size={14} style={{ color: '#10b981' }} /><span style={{ fontSize: 12, color: '#10b981' }}>BlackHole 2ch is installed</span></>}
            {bhStatus === 'not_installed' && <><AlertCircle size={14} style={{ color: '#f59e0b' }} /><span style={{ fontSize: 12, color: '#888' }}>BlackHole not installed</span></>}
            {bhStatus === 'installing' && <><Loader2 size={14} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} /><span style={{ fontSize: 12, color: '#6366f1' }}>Installing… (this may take a minute)</span></>}
            {bhStatus === 'error' && <><AlertCircle size={14} style={{ color: '#ef4444' }} /><span style={{ fontSize: 12, color: '#ef4444' }}>Install failed</span></>}
            {bhStatus === 'unknown' && <span style={{ fontSize: 12, color: '#444' }}>—</span>}
          </div>

          {/* Install button */}
          {(bhStatus === 'not_installed' || bhStatus === 'error') && (
            <button
              onClick={installBlackHole}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 7, border: '1px solid #2a2a2a',
                background: '#161616', color: '#d0d0d0', fontSize: 12, fontWeight: 500,
                cursor: 'pointer', width: 'fit-content',
              }}
            >
              <Radio size={13} /> Install BlackHole 2ch
            </button>
          )}

          {/* Progress log */}
          {bhStatus === 'installing' && bhLog && (
            <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#555', fontFamily: 'monospace' }}>
              {bhLog}
            </div>
          )}

          {/* Post-install instructions */}
          {bhStatus === 'installed' && (
            <div style={{ background: '#0d1a12', border: '1px solid #1a3020', borderRadius: 8, padding: '12px 14px' }}>
              <p style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>⚠ Restart your Mac first — BlackHole won't appear until you do.</p>
              <p style={{ fontSize: 12, color: '#10b981', fontWeight: 600, marginBottom: 8 }}>Then: set up Multi-Output Device in macOS</p>
              <ol style={{ fontSize: 12, color: '#888', lineHeight: 1.8, paddingLeft: 18 }}>
                <li>Open <strong style={{ color: '#aaa' }}>Audio MIDI Setup</strong> (Spotlight → "Audio MIDI Setup")</li>
                <li>Click <strong style={{ color: '#aaa' }}>+</strong> → <strong style={{ color: '#aaa' }}>Create Multi-Output Device</strong></li>
                <li>Check both <strong style={{ color: '#aaa' }}>your speakers/headphones</strong> and <strong style={{ color: '#aaa' }}>BlackHole 2ch</strong></li>
                <li>In System Settings → Sound → set output to <strong style={{ color: '#aaa' }}>Multi-Output Device</strong></li>
                <li>Come back here and select <strong style={{ color: '#aaa' }}>BlackHole 2ch</strong> as Input Device above</li>
              </ol>
            </div>
          )}
        </Section>

        {/* CV */}
        <Section title="CV / Resume">
          <textarea
            value={local.cv}
            onChange={(e) => set('cv', e.target.value)}
            placeholder="Paste your CV here…"
            rows={8}
            style={textareaStyle}
          />
        </Section>

        {/* Job Description */}
        <Section title="Job Description">
          <textarea
            value={local.job_description}
            onChange={(e) => set('job_description', e.target.value)}
            placeholder="Paste the job description here…"
            rows={8}
            style={textareaStyle}
          />
        </Section>

        {/* System Prompt */}
        <Section title="System Prompt (AI Instructions)">
          <textarea
            value={local.system_prompt}
            onChange={(e) => set('system_prompt', e.target.value)}
            rows={12}
            style={textareaStyle}
          />
          <p style={{ fontSize: 11, color: '#444', marginTop: 4 }}>
            Use <code style={{ background: '#1a1a1a', padding: '1px 4px', borderRadius: 3, color: '#888' }}>{'{cv}'}</code> and <code style={{ background: '#1a1a1a', padding: '1px 4px', borderRadius: 3, color: '#888' }}>{'{job_description}'}</code> as placeholders.
          </p>
        </Section>

        {/* User Prompt */}
        <Section title="Question Template">
          <textarea
            value={local.user_prompt}
            onChange={(e) => set('user_prompt', e.target.value)}
            rows={3}
            style={textareaStyle}
          />
          <p style={{ fontSize: 11, color: '#444', marginTop: 4 }}>
            Use <code style={{ background: '#1a1a1a', padding: '1px 4px', borderRadius: 3, color: '#888' }}>{'{transcribed_text}'}</code> as placeholder.
          </p>
        </Section>

        {/* Save button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: saving ? '#1a1a1a' : '#6366f1',
              color: saving ? '#444' : '#fff',
              fontSize: 13, fontWeight: 600,
            }}
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save All'}
          </button>
          {savedMsg && <span style={{ fontSize: 12, color: '#10b981' }}>{savedMsg}</span>}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#111', borderRadius: 10, border: '1px solid #1e1e1e', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a1a1a' }}>
        <span style={{ fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
      </div>
      <div style={{ padding: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: '#666', fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  )
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, borderRadius: 7, border: '1px solid #2a2a2a',
        background: '#161616', color: '#888', cursor: 'pointer', flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

const inputStyle: React.CSSProperties = {
  flex: 1, background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 7,
  color: '#d0d0d0', padding: '7px 10px', fontSize: 13, outline: 'none',
  fontFamily: 'inherit',
}

const selectStyle: React.CSSProperties = {
  background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 7,
  color: '#d0d0d0', padding: '7px 10px', fontSize: 13, outline: 'none',
  fontFamily: 'inherit', width: '100%',
}

const textareaStyle: React.CSSProperties = {
  background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 7,
  color: '#d0d0d0', padding: '10px 12px', fontSize: 13, outline: 'none',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Mono", "Menlo", monospace',
  lineHeight: 1.6, resize: 'vertical', width: '100%',
}
