import { useEffect, useRef, useState } from 'react'
import { X, Minus, Plus } from 'lucide-react'

interface Props {
  text: string
  onClose: () => void
}

export function TeleprompterOverlay({ text, onClose }: Props) {
  const [fontSize, setFontSize] = useState(24)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Auto-scroll to bottom when text grows (stream mode)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(10, 20, 32, 0.35)',
        backdropFilter: 'blur(32px) saturate(120%)',
        WebkitBackdropFilter: 'blur(32px) saturate(120%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '48px 48px 36px',
      }}
    >
      <div
        className="titlebar"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44 }}
      />

      <div
        className="no-drag"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 20,
          flexShrink: 0,
        }}
      >
        <div className="chip" style={{ background: 'var(--color-surface)', color: 'var(--color-accent)', border: '1px solid var(--color-border-strong)' }}>
          Teleprompter
        </div>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setFontSize((s) => Math.max(16, s - 2))}
            className="btn-ghost"
            style={{ padding: '6px 10px' }}
            title="Smaller"
          >
            <Minus size={14} />
          </button>
          <span
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
              minWidth: 32,
              textAlign: 'center',
            }}
          >
            {fontSize}px
          </span>
          <button
            onClick={() => setFontSize((s) => Math.min(36, s + 2))}
            className="btn-ghost"
            style={{ padding: '6px 10px' }}
            title="Larger"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={onClose}
            className="btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
          >
            <X size={14} />
            Esc
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          fontSize,
          lineHeight: 1.75,
          color: 'var(--color-text)',
          fontFamily: 'var(--font-sans)',
          fontWeight: 500,
          whiteSpace: 'pre-wrap',
          letterSpacing: '0.005em',
          padding: '0 8px',
        }}
      >
        {text || (
          <span style={{ color: 'var(--color-text-dim)', fontWeight: 400 }}>
            Press ⌘↵ in the main panel first to generate an answer.
          </span>
        )}
      </div>
    </div>
  )
}
