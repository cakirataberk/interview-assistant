import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Sparkles, Trash2, RotateCcw, Circle, MonitorPlay, MonitorOff } from 'lucide-react'
import type { AppConfig } from '../App'
import { startListening, stopListening, clearHistory, startRecording, stopRecording } from '../lib/api'
import { useBackendWS } from '../hooks/useBackendWS'
import { TeleprompterOverlay } from './TeleprompterOverlay'

interface Props {
  config: AppConfig
}

export function MainPanel({ config }: Props) {
  const [isListening, setIsListening] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isFetchingSuggestion, setIsFetchingSuggestion] = useState(false)
  const [isTeleprompter, setIsTeleprompter] = useState(false)
  const [question, setQuestion] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [statusMsg, setStatusMsg] = useState('Ready')
  const [historyCount, setHistoryCount] = useState(0)
  const [recordDuration, setRecordDuration] = useState(0)
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const electron = (window as any).electronAPI

  const { sendSuggest } = useBackendWS({
    onTranscription: useCallback((text: string) => {
      setQuestion((prev) => prev ? `${prev} ${text}` : text)
      setStatusMsg('Transcribed')
    }, []),
    onPartial: useCallback((text: string) => {
      setQuestion((prev) => prev ? `${prev} ${text}` : text)
      setStatusMsg('Listening…')
    }, []),
    onStatus: useCallback((text: string) => {
      setStatusMsg(text)
    }, []),
    onSuggestionChunk: useCallback((text: string) => {
      setSuggestion((prev) => prev + text)
    }, []),
    onSuggestionDone: useCallback((count: number) => {
      setHistoryCount(count)
      setStatusMsg('AI response ready')
      setIsFetchingSuggestion(false)
    }, []),
    onSuggestionError: useCallback((text: string) => {
      setSuggestion(`Error: ${text}`)
      setStatusMsg('Error')
      setIsFetchingSuggestion(false)
    }, []),
  })

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      // ⌘L → toggle listening
      if (meta && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        toggleListening()
      }
      // ⌘⌫ → clear
      if (meta && e.key === 'Backspace') {
        e.preventDefault()
        setQuestion('')
        setSuggestion('')
        setStatusMsg('Cleared')
      }
      // ⌘↵ → get suggestion (global, not just textarea)
      if (meta && e.key === 'Enter') {
        e.preventDefault()
        fetchSuggestion()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isListening, question, config])

  async function toggleListening() {
    if (isListening) {
      await stopListening()
      setIsListening(false)
      setStatusMsg('Paused')
    } else {
      const res = await startListening(config.microphone_device_index, config.transcription_mode)
      if (res.error) {
        setStatusMsg(`Error: ${res.error}`)
        return
      }
      setIsListening(true)
      setStatusMsg('Listening…')
    }
  }

  function fetchSuggestion() {
    if (!question.trim()) return
    if (!config.api_key) {
      setStatusMsg('No API key — go to Setup')
      return
    }
    setIsFetchingSuggestion(true)
    setSuggestion('')
    setStatusMsg('Asking AI…')
    sendSuggest({
      question: question.trim(),
      api_key: config.api_key,
      cv: config.cv,
      job_description: config.job_description,
      system_prompt: config.system_prompt,
      user_prompt: config.user_prompt,
    })
  }

  async function handleClearHistory() {
    await clearHistory()
    setHistoryCount(0)
    setStatusMsg('History cleared')
  }

  async function toggleRecording() {
    if (isRecording) {
      await stopRecording()
      setIsRecording(false)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      setRecordDuration(0)
      setStatusMsg('Recording saved')
    } else {
      const res = await startRecording(config.microphone_device_index)
      if (res.error) {
        setStatusMsg(`Recording error: ${res.error}`)
        return
      }
      setIsRecording(true)
      setRecordDuration(0)
      recordTimerRef.current = setInterval(() => setRecordDuration((d) => d + 1), 1000)
      setStatusMsg('Recording…')
    }
  }

  function toggleTeleprompter() {
    const next = !isTeleprompter
    setIsTeleprompter(next)
    electron?.setAlwaysOnTop(next)
    if (next) electron?.setOpacity(0.55)
    else electron?.setOpacity(config.window_alpha)
  }

  const fmtDuration = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px 14px 10px', gap: 10, overflow: 'hidden' }}>

      {/* Status bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isListening ? '#10b981' : '#ef4444',
            boxShadow: isListening ? '0 0 6px #10b981' : 'none',
          }} />
          <span style={{ fontSize: 12, color: '#666' }}>{isListening ? 'Listening' : 'Paused'}</span>
        </div>
        <span style={{ color: '#2a2a2a' }}>|</span>
        <span style={{ fontSize: 12, color: '#555', flex: 1 }}>{statusMsg}</span>
        <span style={{ fontSize: 11, color: '#444', background: '#141414', padding: '2px 8px', borderRadius: 4, border: '1px solid #222' }}>
          History {historyCount}/5
        </span>
      </div>

      {/* AI Suggestion */}
      <div style={{ flex: 3, display: 'flex', flexDirection: 'column', background: '#111', borderRadius: 10, border: '1px solid #1e1e1e', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #1a1a1a' }}>
          <span style={{ fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI Response</span>
          <button
            onClick={fetchSuggestion}
            disabled={isFetchingSuggestion || !question.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: isFetchingSuggestion || !question.trim() ? '#1a1a1a' : '#6366f1',
              color: isFetchingSuggestion || !question.trim() ? '#444' : '#fff',
              fontSize: 12, fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            <Sparkles size={13} />
            {isFetchingSuggestion ? 'Thinking…' : 'Get Suggestion'}
          </button>
        </div>
        <div style={{
          flex: 1, padding: '12px 14px', overflowY: 'auto',
          fontSize: 15, lineHeight: 1.65, color: suggestion ? '#e0e0e0' : '#333',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
          whiteSpace: 'pre-wrap',
        }}>
          {isFetchingSuggestion
            ? <span style={{ color: '#555' }}>Thinking…</span>
            : suggestion || <span>Suggestion will appear here…</span>
          }
        </div>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <Btn onClick={toggleListening} active={isListening} activeColor="#10b981"
          icon={isListening ? <MicOff size={14} /> : <Mic size={14} />}
          label={isListening ? 'Stop Listening' : 'Start Listening'} shortcut="⌘L" />
        <Btn onClick={fetchSuggestion} disabled={isFetchingSuggestion || !question.trim()}
          icon={<Sparkles size={14} />} label="Suggest" shortcut="⌘↵" accent />
        <Btn onClick={() => { setQuestion(''); setSuggestion(''); setStatusMsg('Cleared') }}
          icon={<Trash2 size={14} />} label="Clear" shortcut="⌘⌫" />
        <Btn onClick={handleClearHistory} icon={<RotateCcw size={14} />} label="Clear History" />
        <Btn onClick={toggleRecording} active={isRecording} activeColor="#ef4444"
          icon={<Circle size={14} fill={isRecording ? '#ef4444' : 'none'} />}
          label={isRecording ? `Stop (${fmtDuration(recordDuration)})` : 'Record'} />
        <Btn onClick={toggleTeleprompter} active={isTeleprompter} activeColor="#6366f1"
          icon={isTeleprompter ? <MonitorOff size={14} /> : <MonitorPlay size={14} />}
          label={isTeleprompter ? 'Exit Teleprompter' : 'Teleprompter'} />
      </div>

      {/* Question box */}
      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', background: '#111', borderRadius: 10, border: '1px solid #1e1e1e', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid #1a1a1a' }}>
          <span style={{ fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Question (editable)</span>
        </div>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Question will appear here as you speak, or type directly…"
          style={{
            flex: 1, padding: '12px 14px', background: 'transparent', border: 'none', outline: 'none',
            color: '#d0d0d0', fontSize: 14, lineHeight: 1.6, resize: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      {isTeleprompter && <TeleprompterOverlay text={suggestion} onClose={toggleTeleprompter} />}
    </div>
  )
}

function Btn({ onClick, icon, label, shortcut, active, activeColor, accent, disabled }: {
  onClick: () => void; icon: React.ReactNode; label: string; shortcut?: string
  active?: boolean; activeColor?: string; accent?: boolean; disabled?: boolean
}) {
  const bg = active ? `${activeColor}22` : accent ? '#6366f1' : '#161616'
  const border = active ? activeColor : accent ? '#6366f1' : '#222'
  const color = active ? activeColor : accent ? '#fff' : '#888'
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '6px 12px', borderRadius: 7, border: `1px solid ${disabled ? '#1a1a1a' : border}`,
      background: disabled ? '#0e0e0e' : bg, color: disabled ? '#333' : color,
      fontSize: 12, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.12s', flexShrink: 0, whiteSpace: 'nowrap',
    }}>
      {icon}{label}
      {shortcut && (
        <span style={{
          marginLeft: 4, fontSize: 10, fontWeight: 500,
          color: disabled ? '#2a2a2a' : active ? activeColor : accent ? 'rgba(255,255,255,0.6)' : '#444',
          background: disabled ? 'transparent' : '#0d0d0d',
          border: `1px solid ${disabled ? 'transparent' : '#222'}`,
          borderRadius: 4, padding: '1px 5px', letterSpacing: '0.02em',
        }}>
          {shortcut}
        </span>
      )}
    </button>
  )
}
