import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Mic,
  MicOff,
  Sparkles,
  Trash2,
  RotateCcw,
  MonitorPlay,
  MonitorOff,
  Settings,
  Square,
  Clock,
  ShieldCheck,
} from 'lucide-react'
import type { AppConfigRemote, ActiveSession } from '../lib/api'
import {
  startListening,
  stopListening,
  clearHistory,
  endSession,
} from '../lib/api'
import { useBackendWS } from '../hooks/useBackendWS'
import { TeleprompterOverlay } from './TeleprompterOverlay'

type ElectronAPI = {
  setOpacity?: (v: number) => Promise<void>
  setAlwaysOnTop?: (v: boolean) => Promise<void>
}

function electron(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
}

function formatClock(seconds: number): string {
  const mm = Math.floor(Math.max(seconds, 0) / 60)
  const ss = Math.max(seconds, 0) % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

interface Props {
  config: AppConfigRemote
  session: ActiveSession
  onOpenSettings: () => void
  onSessionEnded: () => void
}

export function MainPanel({ config, session, onOpenSettings, onSessionEnded }: Props) {
  const isEn = config.locale === 'en'
  const [isListening, setIsListening] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isTeleprompter, setIsTeleprompter] = useState(false)
  const [question, setQuestion] = useState('')
  const [partial, setPartial] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [historyCount, setHistoryCount] = useState(0)
  const [statusMsg, setStatusMsg] = useState(isEn ? 'Ready' : 'Hazır')
  const [secondsRemaining, setSecondsRemaining] = useState<number>(session.secondsRemaining)
  const [sessionExpired, setSessionExpired] = useState(false)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const t = isEn
    ? {
        listening: 'Listening',
        paused: 'Paused',
        transcript: 'Interviewer',
        answer: 'AI answer',
        placeholderQ: 'The interviewer\'s question will appear here — you can also type.',
        placeholderA: 'Press ⌘↵ or tap Suggest to get an answer.',
        listen: 'Listen',
        stop: 'Stop',
        suggest: 'Suggest',
        clear: 'Clear',
        clearHistory: 'Clear history',
        teleprompter: 'Teleprompter',
        exitPrompter: 'Exit prompter',
        settings: 'Settings',
        end: 'End session',
        history: 'History',
        unlimited: 'Unlimited',
        remaining: 'Trial',
        expired: 'Trial ended — please upgrade on basvur.ai',
        thinking: 'Thinking…',
      }
    : {
        listening: 'Dinliyor',
        paused: 'Duraklatıldı',
        transcript: 'Soru',
        answer: 'AI cevabı',
        placeholderQ: 'Soru buraya yansıyacak — yazı da girebilirsin.',
        placeholderA: '⌘↵ ile ya da Cevap üret butonuyla yanıt alın.',
        listen: 'Dinle',
        stop: 'Durdur',
        suggest: 'Cevap üret',
        clear: 'Temizle',
        clearHistory: 'Geçmişi temizle',
        teleprompter: 'Teleprompter',
        exitPrompter: 'Prompter\'dan çık',
        settings: 'Ayarlar',
        end: 'Oturumu bitir',
        history: 'Geçmiş',
        unlimited: 'Sınırsız',
        remaining: 'Deneme',
        expired: 'Deneme süren bitti — basvur.ai üzerinden PRO\'ya geç.',
        thinking: 'Düşünüyor…',
      }

  const { sendSuggest } = useBackendWS({
    onTranscription: useCallback((text: string) => {
      setQuestion((prev) => (prev ? `${prev} ${text}` : text))
      setPartial('')
      setStatusMsg(isEn ? 'Transcribed' : 'Yazıldı')
    }, [isEn]),
    onPartial: useCallback((text: string) => {
      setPartial(text)
      setStatusMsg(isEn ? 'Listening…' : 'Dinleniyor…')
    }, [isEn]),
    onStatus: useCallback((text: string) => setStatusMsg(text), []),
    onSuggestionChunk: useCallback((text: string) => {
      setSuggestion((prev) => prev + text)
    }, []),
    onSuggestionDone: useCallback((count: number) => {
      setHistoryCount(count)
      setIsFetching(false)
      setStatusMsg(isEn ? 'Answer ready' : 'Cevap hazır')
    }, [isEn]),
    onSuggestionError: useCallback((text: string) => {
      setIsFetching(false)
      setSuggestion(`Error: ${text}`)
      setStatusMsg(isEn ? 'Error' : 'Hata')
    }, [isEn]),
    onQuota: useCallback((secs: number, shouldStop: boolean) => {
      setSecondsRemaining(secs)
      if (shouldStop) {
        setSessionExpired(true)
        setIsListening(false)
      }
    }, []),
    onSessionExpired: useCallback(() => {
      setSessionExpired(true)
      setIsListening(false)
    }, []),
  })

  // Local 1s tick while listening (for a smooth countdown between heartbeats)
  useEffect(() => {
    if (!isListening || session.plan === 'PRO') {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
      return
    }
    tickRef.current = setInterval(() => {
      setSecondsRemaining((s) => Math.max(0, s - 1))
    }, 1000)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [isListening, session.plan])

  // Apply window opacity on mount
  useEffect(() => {
    electron()?.setOpacity?.(config.window_alpha)
  }, [config.window_alpha])

  const toggleListening = useCallback(async () => {
    if (sessionExpired) return
    if (isListening) {
      await stopListening()
      setIsListening(false)
      setStatusMsg(t.paused)
    } else {
      const res = await startListening(config.microphone_device_index, config.transcription_mode)
      if (res?.error) {
        setStatusMsg(`Error: ${res.error}`)
        return
      }
      setIsListening(true)
      setStatusMsg(t.listening)
    }
  }, [isListening, sessionExpired, config.microphone_device_index, config.transcription_mode, t.listening, t.paused])

  const fetchSuggestion = useCallback(() => {
    if (sessionExpired) return
    const q = question.trim()
    if (!q) return
    setIsFetching(true)
    setSuggestion('')
    setStatusMsg(t.thinking)
    sendSuggest(q)
  }, [question, sessionExpired, sendSuggest, t.thinking])

  const clearAll = useCallback(() => {
    setQuestion('')
    setPartial('')
    setSuggestion('')
    setStatusMsg(isEn ? 'Cleared' : 'Temizlendi')
  }, [isEn])

  const resetHistory = useCallback(async () => {
    await clearHistory()
    setHistoryCount(0)
    setStatusMsg(isEn ? 'History cleared' : 'Geçmiş temizlendi')
  }, [isEn])

  const toggleTeleprompter = useCallback(() => {
    const next = !isTeleprompter
    setIsTeleprompter(next)
    electron()?.setAlwaysOnTop?.(next)
    electron()?.setOpacity?.(next ? 0.62 : config.window_alpha)
  }, [isTeleprompter, config.window_alpha])

  const endCurrentSession = useCallback(async () => {
    if (isListening) await stopListening()
    await endSession()
    onSessionEnded()
  }, [isListening, onSessionEnded])

  // Global shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        toggleListening()
      } else if (meta && e.key === 'Backspace') {
        e.preventDefault()
        clearAll()
      } else if (meta && e.key === 'Enter') {
        e.preventDefault()
        fetchSuggestion()
      } else if (e.key === 'Escape' && isTeleprompter) {
        toggleTeleprompter()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [toggleListening, clearAll, fetchSuggestion, toggleTeleprompter, isTeleprompter])

  const isPro = session.plan === 'PRO'
  const combined = (question + (partial ? ` ${partial}` : '')).trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Titlebar */}
      <div
        className="titlebar"
        style={{
          height: 52,
          paddingLeft: 84,
          paddingRight: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isListening
                ? 'var(--color-success)'
                : sessionExpired
                  ? 'var(--color-danger)'
                  : 'var(--color-text-dim)',
              boxShadow: isListening ? '0 0 8px var(--color-success)' : 'none',
              animation: isListening ? 'pulse-dot 1.4s ease-in-out infinite' : undefined,
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>
            {isListening ? t.listening : t.paused}
          </span>
        </div>

        <span style={{ color: 'var(--color-border-strong)' }}>|</span>

        <span
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            pointerEvents: 'none',
          }}
        >
          {session.jobTitle || (isEn ? 'Custom JD' : 'Özel JD')}
          {session.company ? ` • ${session.company}` : ''}
        </span>

        <span
          className="chip"
          style={{
            marginLeft: 'auto',
            background: isPro ? 'var(--color-success-soft)' : 'var(--color-accent-soft)',
            color: isPro ? 'var(--color-success)' : 'var(--color-accent)',
            border: isPro
              ? '1px solid rgba(16,185,129,0.3)'
              : '1px solid rgba(230,126,34,0.35)',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {isPro ? (
            <><ShieldCheck size={12} /> {t.unlimited}</>
          ) : (
            <><Clock size={12} /> {t.remaining} {formatClock(secondsRemaining)}</>
          )}
        </span>

        <div className="no-drag" style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onOpenSettings}
            className="btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}
          >
            <Settings size={13} />
          </button>
          <button
            onClick={endCurrentSession}
            className="btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}
            title={t.end}
          >
            <Square size={13} />
          </button>
        </div>
      </div>

      {/* Split panels */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: '8px 14px 4px',
          minHeight: 0,
        }}
      >
        <SplitPanel title={t.transcript} tone="muted">
          <textarea
            value={combined}
            onChange={(e) => {
              setQuestion(e.target.value)
              setPartial('')
            }}
            placeholder={t.placeholderQ}
            style={{
              flex: 1,
              padding: '14px 16px',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-text)',
              fontSize: 15,
              lineHeight: 1.65,
              resize: 'none',
              fontFamily: 'inherit',
              whiteSpace: 'pre-wrap',
            }}
          />
        </SplitPanel>

        <SplitPanel title={t.answer} tone="accent">
          <div
            style={{
              flex: 1,
              padding: '14px 16px',
              overflowY: 'auto',
              fontSize: 15,
              lineHeight: 1.65,
              color: 'var(--color-text)',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
            }}
          >
            {suggestion ? (
              <span>
                {suggestion}
                {isFetching && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 18,
                      marginLeft: 2,
                      verticalAlign: -3,
                      background: 'var(--color-accent)',
                      animation: 'blink-cursor 1s steps(2,end) infinite',
                    }}
                  />
                )}
              </span>
            ) : isFetching ? (
              <span style={{ color: 'var(--color-text-muted)' }}>{t.thinking}</span>
            ) : (
              <span style={{ color: 'var(--color-text-dim)' }}>{t.placeholderA}</span>
            )}
          </div>
        </SplitPanel>
      </div>

      {/* Status bar */}
      <div
        style={{
          padding: '4px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 11,
          color: 'var(--color-text-dim)',
        }}
      >
        <span style={{ flex: 1 }}>{statusMsg}</span>
        <span className="chip" style={{ fontSize: 10 }}>
          {t.history} {historyCount}/5
        </span>
      </div>

      {/* Action bar */}
      <div
        style={{
          padding: '8px 14px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <Action
          icon={isListening ? <MicOff size={14} /> : <Mic size={14} />}
          label={isListening ? t.stop : t.listen}
          shortcut="⌘L"
          onClick={toggleListening}
          active={isListening}
          accent={!isListening}
          disabled={sessionExpired}
        />
        <Action
          icon={<Sparkles size={14} />}
          label={t.suggest}
          shortcut="⌘↵"
          onClick={fetchSuggestion}
          disabled={!combined || isFetching || sessionExpired}
          primary
        />
        <Action
          icon={<Trash2 size={14} />}
          label={t.clear}
          shortcut="⌘⌫"
          onClick={clearAll}
        />
        <Action
          icon={<RotateCcw size={14} />}
          label={t.clearHistory}
          onClick={resetHistory}
        />
        <Action
          icon={isTeleprompter ? <MonitorOff size={14} /> : <MonitorPlay size={14} />}
          label={isTeleprompter ? t.exitPrompter : t.teleprompter}
          onClick={toggleTeleprompter}
          active={isTeleprompter}
        />
      </div>

      {sessionExpired && (
        <div
          style={{
            position: 'absolute',
            bottom: 76,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(239,68,68,0.14)',
            border: '1px solid rgba(239,68,68,0.4)',
            color: 'var(--color-danger)',
            padding: '8px 14px',
            borderRadius: 10,
            fontSize: 12,
          }}
        >
          {t.expired}
        </div>
      )}

      {isTeleprompter && <TeleprompterOverlay text={suggestion} onClose={toggleTeleprompter} />}
    </div>
  )
}

function SplitPanel({
  title,
  tone,
  children,
}: {
  title: string
  tone: 'muted' | 'accent'
  children: React.ReactNode
}) {
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: tone === 'accent' ? 'var(--color-accent)' : 'var(--color-text-muted)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Action({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  active,
  primary,
  accent,
}: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  primary?: boolean
  accent?: boolean
}) {
  const bg = active
    ? 'var(--color-primary-soft)'
    : primary
      ? 'var(--color-accent)'
      : accent
        ? 'var(--color-primary)'
        : 'var(--color-surface-solid)'
  const border = active
    ? 'var(--color-primary-hover)'
    : primary
      ? 'var(--color-accent-hover)'
      : accent
        ? 'var(--color-primary-hover)'
        : 'var(--color-border-strong)'
  const color = primary ? '#1a0d02' : active ? 'var(--color-text)' : 'var(--color-text)'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="no-drag"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '8px 14px',
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'transform 120ms, background 120ms',
      }}
    >
      {icon}
      {label}
      {shortcut && (
        <span
          style={{
            marginLeft: 4,
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: primary ? 'rgba(26,13,2,0.55)' : 'var(--color-text-muted)',
            background: primary ? 'rgba(26,13,2,0.12)' : 'rgba(255,255,255,0.04)',
            border: primary ? '1px solid rgba(26,13,2,0.25)' : '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '1px 6px',
            letterSpacing: '0.02em',
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  )
}
