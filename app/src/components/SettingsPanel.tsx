import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  LogOut,
  Radio,
} from 'lucide-react'
import { getDevices, type AppConfigRemote, type ActiveSession } from '../lib/api'

const TRANSCRIPTION_MODES = ['English', 'Türkçe', 'TR + ENG (Mixed)']

type BlackHoleStatus = 'unknown' | 'checking' | 'installed' | 'not_installed' | 'installing' | 'error'

type ElectronAPI = {
  blackholeCheck?: () => Promise<boolean>
  blackholeInstall?: () => Promise<{ ok: boolean }>
  onBlackholeProgress?: (cb: (data: { status: string; detail: string }) => void) => void
  setOpacity?: (v: number) => Promise<void>
}

function electron(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
}

interface Props {
  config: AppConfigRemote
  session: ActiveSession | null
  onChange: (updates: Partial<AppConfigRemote>) => Promise<void>
  onBack: () => void
  onLogout: () => void
}

function formatClock(seconds: number): string {
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export function SettingsPanel({ config, session, onChange, onBack, onLogout }: Props) {
  const [devices, setDevices] = useState<{ index: number; name: string }[]>([])
  const [bhStatus, setBhStatus] = useState<BlackHoleStatus>('unknown')
  const [bhLog, setBhLog] = useState('')
  const isEn = config.locale === 'en'

  const t = isEn
    ? {
        back: 'Back',
        title: 'Settings',
        session: 'Session',
        plan: 'Plan',
        trialRemaining: 'Trial left',
        unlimited: 'Unlimited',
        job: 'Current job',
        noSession: 'No active session',
        audio: 'Audio',
        transcription: 'Transcription language',
        inputDevice: 'Input device',
        window: 'Window',
        opacity: 'Opacity',
        language: 'Language',
        tr: 'Türkçe',
        en: 'English',
        blackhole: 'Meeting audio (BlackHole)',
        blackholeHint: 'Lets the app capture system audio from Zoom/Meet/Teams.',
        install: 'Install BlackHole 2ch',
        installing: 'Installing… this can take a minute',
        installed: 'BlackHole 2ch is installed',
        notInstalled: 'BlackHole not installed',
        installError: 'Install failed',
        logout: 'Logout',
      }
    : {
        back: 'Geri',
        title: 'Ayarlar',
        session: 'Oturum',
        plan: 'Plan',
        trialRemaining: 'Kalan süre',
        unlimited: 'Sınırsız',
        job: 'Aktif pozisyon',
        noSession: 'Aktif oturum yok',
        audio: 'Ses',
        transcription: 'Transkripsiyon dili',
        inputDevice: 'Giriş cihazı',
        window: 'Pencere',
        opacity: 'Opaklık',
        language: 'Uygulama dili',
        tr: 'Türkçe',
        en: 'English',
        blackhole: 'Toplantı sesi (BlackHole)',
        blackholeHint: 'Zoom/Meet/Teams gibi uygulamaların sesini yakalayabilmek için gerekli.',
        install: 'BlackHole 2ch kur',
        installing: 'Kuruluyor… (1–2 dk sürebilir)',
        installed: 'BlackHole 2ch yüklü',
        notInstalled: 'BlackHole kurulu değil',
        installError: 'Kurulum başarısız',
        logout: 'Çıkış yap',
      }

  const loadDevices = async () => {
    try {
      const d = await getDevices()
      setDevices(d)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadDevices()
    electron()?.blackholeCheck?.().then((ok) => {
      setBhStatus(ok ? 'installed' : 'not_installed')
    }).catch(() => {})
    electron()?.onBlackholeProgress?.((data) => {
      if (data.status === 'progress' && data.detail) setBhLog(data.detail.slice(-120))
      else if (data.status === 'done') { setBhStatus('installed'); loadDevices() }
      else if (data.status === 'error') { setBhStatus('error'); setBhLog(data.detail) }
    })
  }, [])

  const installBlackHole = async () => {
    setBhStatus('installing')
    setBhLog('')
    await electron()?.blackholeInstall?.()
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        className="titlebar"
        style={{
          height: 48,
          paddingLeft: 80,
          paddingRight: 16,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          className="btn-ghost no-drag"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <ArrowLeft size={14} />
          {t.back}
        </button>
        <span
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            pointerEvents: 'none',
          }}
        >
          {t.title}
        </span>
        <button
          onClick={onLogout}
          className="btn-ghost no-drag"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <LogOut size={14} />
          {t.logout}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px 28px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Session card */}
          <Section title={t.session}>
            {session ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Stat label={t.plan} value={session.plan === 'PRO' ? 'PRO' : 'FREE'} accent={session.plan === 'PRO'} />
                <Stat
                  label={t.trialRemaining}
                  value={session.plan === 'PRO' ? t.unlimited : formatClock(session.secondsRemaining)}
                  accent={session.plan === 'PRO'}
                />
                <Stat
                  label={t.job}
                  value={session.jobTitle ? `${session.jobTitle}${session.company ? ' • ' + session.company : ''}` : '—'}
                  span={2}
                />
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t.noSession}</p>
            )}
          </Section>

          {/* Audio */}
          <Section title={t.audio}>
            <Field label={t.transcription}>
              <select
                value={config.transcription_mode}
                onChange={(e) => onChange({ transcription_mode: e.target.value })}
                style={selectStyle}
              >
                {TRANSCRIPTION_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>

            <Field label={t.inputDevice}>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={config.microphone_device_index}
                  onChange={(e) =>
                    onChange({ microphone_device_index: parseInt(e.target.value) })
                  }
                  style={{ ...selectStyle, flex: 1 }}
                >
                  {devices.map((d) => (
                    <option key={d.index} value={d.index}>
                      {d.index}: {d.name}
                    </option>
                  ))}
                  {devices.length === 0 && <option value={0}>—</option>}
                </select>
                <button
                  onClick={loadDevices}
                  className="btn-ghost"
                  style={{ padding: '6px 10px' }}
                  title="Refresh"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </Field>
          </Section>

          {/* BlackHole */}
          <Section title={t.blackhole}>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              {t.blackholeHint}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {bhStatus === 'checking' && (
                <><Loader2 size={14} style={{ color: 'var(--color-primary-hover)', animation: 'spin 1s linear infinite' }} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>…</span></>
              )}
              {bhStatus === 'installed' && (
                <><CheckCircle size={14} style={{ color: 'var(--color-success)' }} />
                  <span style={{ fontSize: 12, color: 'var(--color-success)' }}>{t.installed}</span></>
              )}
              {bhStatus === 'not_installed' && (
                <><AlertCircle size={14} style={{ color: 'var(--color-warning)' }} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t.notInstalled}</span></>
              )}
              {bhStatus === 'installing' && (
                <><Loader2 size={14} style={{ color: 'var(--color-primary-hover)', animation: 'spin 1s linear infinite' }} />
                  <span style={{ fontSize: 12, color: 'var(--color-primary-hover)' }}>{t.installing}</span></>
              )}
              {bhStatus === 'error' && (
                <><AlertCircle size={14} style={{ color: 'var(--color-danger)' }} />
                  <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>{t.installError}</span></>
              )}
            </div>

            {(bhStatus === 'not_installed' || bhStatus === 'error') && (
              <button
                onClick={installBlackHole}
                className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content' }}
              >
                <Radio size={14} />
                {t.install}
              </button>
            )}

            {bhStatus === 'installing' && bhLog && (
              <div
                style={{
                  background: 'var(--color-surface-solid)',
                  border: '1px solid var(--color-border-strong)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {bhLog}
              </div>
            )}
          </Section>

          {/* Window + language */}
          <Section title={t.window}>
            <Field label={`${t.opacity} — ${Math.round(config.window_alpha * 100)}%`}>
              <input
                type="range"
                min={40}
                max={100}
                value={Math.round(config.window_alpha * 100)}
                onChange={(e) => {
                  const v = parseInt(e.target.value) / 100
                  onChange({ window_alpha: v })
                }}
                style={{ width: '100%', accentColor: 'var(--color-accent)' }}
              />
            </Field>
            <Field label={t.language}>
              <select
                value={config.locale}
                onChange={(e) => onChange({ locale: e.target.value })}
                style={selectStyle}
              >
                <option value="tr">{t.tr}</option>
                <option value="en">{t.en}</option>
              </select>
            </Field>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  span,
}: {
  label: string
  value: string
  accent?: boolean
  span?: number
}) {
  return (
    <div
      style={{
        background: 'var(--color-surface-solid)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 10,
        padding: '10px 12px',
        gridColumn: span ? `span ${span}` : undefined,
      }}
    >
      <p
        style={{
          fontSize: 10,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 2,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 13,
          color: accent ? 'var(--color-accent)' : 'var(--color-text)',
          fontWeight: 600,
        }}
      >
        {value}
      </p>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  background: 'var(--color-surface-solid)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 10,
  color: 'var(--color-text)',
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
}
