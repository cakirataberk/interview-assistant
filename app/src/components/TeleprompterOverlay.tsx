import { X } from 'lucide-react'

interface Props {
  text: string
  onClose: () => void
}

export function TeleprompterOverlay({ text, onClose }: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(5,5,5,0.92)',
        display: 'flex', flexDirection: 'column',
        padding: '44px 32px 24px',
      }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, flexShrink: 0 }}>
        <button
          onClick={onClose}
          className="no-drag"
          style={{
            background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6,
            color: '#888', padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
          }}
        >
          <X size={12} /> Exit (Esc)
        </button>
      </div>

      <div
        style={{
          flex: 1, overflowY: 'auto',
          fontSize: 20, lineHeight: 1.8,
          color: '#e8e8e8',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          fontWeight: 400,
          whiteSpace: 'pre-wrap',
          letterSpacing: '0.01em',
        }}
      >
        {text || <span style={{ color: '#333' }}>No suggestion yet — press "Get Suggestion" first</span>}
      </div>
    </div>
  )
}
