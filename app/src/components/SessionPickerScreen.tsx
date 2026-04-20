import { useEffect, useState } from 'react'
import {
  Briefcase,
  Building2,
  FileText,
  Loader2,
  LogOut,
  Plus,
  Settings,
  Sparkles,
  ArrowRight,
  RefreshCw,
} from 'lucide-react'
import {
  endSession,
  getJobs,
  startSession,
  type AppConfigRemote,
  type JobOption,
} from '../lib/api'

interface Props {
  locale: string
  onSessionStarted: () => void
  onOpenSettings: () => void
  onLogout: () => void
  onConfigChange: (updates: Partial<AppConfigRemote>) => Promise<void>
}

export function SessionPickerScreen({
  locale,
  onSessionStarted,
  onOpenSettings,
  onLogout,
  onConfigChange,
}: Props) {
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customTitle, setCustomTitle] = useState('')
  const [customCompany, setCustomCompany] = useState('')
  const [customJd, setCustomJd] = useState('')
  const [starting, setStarting] = useState(false)

  const labels = locale === 'en'
    ? {
        title: 'Which interview are you preparing for?',
        subtitle: 'Pick a tracked job or paste a custom JD. We tailor the copilot using your CV.',
        empty: 'No jobs from your tracker yet.',
        refresh: 'Refresh',
        addCustom: 'Custom JD',
        startBtn: 'Start session',
        titlePlaceholder: 'Job title (e.g. Senior Frontend Engineer)',
        companyPlaceholder: 'Company (optional)',
        jdPlaceholder: 'Paste the job description here…',
        cancel: 'Cancel',
        save: 'Use this JD',
        settings: 'Settings',
        logout: 'Logout',
        startError: 'Could not start session',
        languageLabel: 'Interview language',
      }
    : {
        title: 'Hangi mülakata hazırlanıyorsun?',
        subtitle: 'Takipteki iş ilanlarından seç veya özel JD yapıştır. CV\'ne göre uyarlanır.',
        empty: 'Tracker\'da henüz ilan yok.',
        refresh: 'Yenile',
        addCustom: 'Özel JD',
        startBtn: 'Oturumu başlat',
        titlePlaceholder: 'Pozisyon (örn. Senior Frontend Engineer)',
        companyPlaceholder: 'Şirket (opsiyonel)',
        jdPlaceholder: 'İş tanımını buraya yapıştır…',
        cancel: 'Vazgeç',
        save: 'Bu JD ile başla',
        settings: 'Ayarlar',
        logout: 'Çıkış',
        startError: 'Oturum başlatılamadı',
        languageLabel: 'Mülakat dili',
      }

  const setLanguage = async (lang: 'tr' | 'en') => {
    if (lang === locale) return
    await onConfigChange({
      locale: lang,
      transcription_mode: lang === 'tr' ? 'Türkçe' : 'English',
    })
  }

  const loadJobs = async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const data = await getJobs()
      if ('jobs' in data) setJobs(data.jobs)
      else setErrorMsg(data.error)
    } catch (err) {
      setErrorMsg(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadJobs()
    // If there is a stale backend session (e.g. from crash), clear it quietly
    endSession().catch(() => {})
  }, [])

  const startWithJob = async (jobMatchId: string) => {
    setStarting(true)
    setErrorMsg('')
    const res = await startSession({ jobMatchId })
    setStarting(false)
    if ('ok' in res) onSessionStarted()
    else setErrorMsg(res.detail || res.error || labels.startError)
  }

  const startWithCustom = async () => {
    if (!customJd.trim()) return
    setStarting(true)
    setErrorMsg('')
    const res = await startSession({
      customJdSnippet: customJd.trim(),
      customJdTitle: customTitle.trim() || null,
      customJdCompany: customCompany.trim() || null,
    })
    setStarting(false)
    if ('ok' in res) onSessionStarted()
    else setErrorMsg(res.detail || res.error || labels.startError)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* Titlebar */}
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
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            pointerEvents: 'none',
          }}
        >
          basvur.ai Copilot
        </span>
        <div className="no-drag" style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onOpenSettings}
            className="btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Settings size={14} />
            {labels.settings}
          </button>
          <button
            onClick={onLogout}
            className="btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <LogOut size={14} />
            {labels.logout}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 28px 32px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{labels.title}</h1>
          <p
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            {labels.subtitle}
          </p>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {labels.languageLabel}
            </span>
            <div
              role="group"
              aria-label={labels.languageLabel}
              style={{
                display: 'inline-flex',
                background: 'var(--color-surface-solid)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 999,
                padding: 2,
              }}
            >
              {(['tr', 'en'] as const).map((lang) => {
                const active = locale === lang
                return (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className="no-drag"
                    style={{
                      border: 'none',
                      borderRadius: 999,
                      padding: '5px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: active ? 'var(--color-accent)' : 'transparent',
                      color: active ? '#0a0a0a' : 'var(--color-text-muted)',
                      transition: 'background 120ms, color 120ms',
                    }}
                  >
                    {lang === 'tr' ? 'TR' : 'EN'}
                  </button>
                )
              })}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 14,
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={loadJobs}
              className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={14} />
              {labels.refresh}
            </button>
            <button
              onClick={() => setCustomOpen((v) => !v)}
              className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={14} />
              {labels.addCustom}
            </button>
          </div>

          {customOpen && (
            <div className="card" style={{ padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={labels.titlePlaceholder}
                  style={inputStyle}
                />
                <input
                  value={customCompany}
                  onChange={(e) => setCustomCompany(e.target.value)}
                  placeholder={labels.companyPlaceholder}
                  style={inputStyle}
                />
              </div>
              <textarea
                value={customJd}
                onChange={(e) => setCustomJd(e.target.value)}
                placeholder={labels.jdPlaceholder}
                rows={6}
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  width: '100%',
                  fontFamily: 'var(--font-sans)',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <button onClick={() => setCustomOpen(false)} className="btn-ghost">
                  {labels.cancel}
                </button>
                <button
                  onClick={startWithCustom}
                  disabled={!customJd.trim() || starting}
                  className="btn-accent"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {starting ? (
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {labels.save}
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid rgba(239,68,68,0.4)',
                background: 'rgba(239,68,68,0.12)',
                color: 'var(--color-danger)',
                fontSize: 12,
                marginBottom: 14,
              }}
            >
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: 'var(--color-text-muted)',
                fontSize: 13,
              }}
            >
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Yükleniyor…
            </div>
          ) : jobs.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <Briefcase size={22} style={{ color: 'var(--color-text-dim)', marginBottom: 8 }} />
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{labels.empty}</p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 12,
              }}
            >
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => setSelected(job.id)}
                  className="card no-drag"
                  style={{
                    textAlign: 'left',
                    padding: 16,
                    cursor: 'pointer',
                    border:
                      selected === job.id
                        ? '1px solid var(--color-accent)'
                        : '1px solid var(--color-border)',
                    transition: 'border-color 120ms',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <Briefcase size={14} style={{ color: 'var(--color-accent)' }} />
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {job.status ?? 'saved'}
                    </span>
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                    {job.jobTitle}
                  </p>
                  {job.company && (
                    <p
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-muted)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Building2 size={12} />
                      {job.company}
                    </p>
                  )}
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--color-text-dim)',
                      marginTop: 10,
                      lineHeight: 1.55,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    <FileText size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                    {job.jobDescription.slice(0, 240)}
                  </p>
                  {selected === job.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        startWithJob(job.id)
                      }}
                      disabled={starting}
                      className="btn-accent"
                      style={{
                        marginTop: 12,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        width: '100%',
                        justifyContent: 'center',
                      }}
                    >
                      {starting ? (
                        <Loader2
                          size={14}
                          style={{ animation: 'spin 1s linear infinite' }}
                        />
                      ) : (
                        <ArrowRight size={14} />
                      )}
                      {labels.startBtn}
                    </button>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--color-surface-solid)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 10,
  color: 'var(--color-text)',
  padding: '9px 12px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
}
