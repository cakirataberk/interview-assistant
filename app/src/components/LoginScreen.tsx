import { useEffect, useState } from 'react'
import { Sparkles, LogIn, Loader2, AlertCircle, ExternalLink } from 'lucide-react'

type ElectronAPI = {
  startLinkFlow?: (locale: string) => Promise<{ ok: boolean; state: string }>
  onLinkProgress?: (cb: (stage: string) => void) => void
  onLinkDone?: (cb: (data: { ok: boolean }) => void) => void
  onLinkError?: (cb: (data: { message: string }) => void) => void
  openExternal?: (url: string) => Promise<void>
  getApiBase?: () => Promise<string>
}

function electron(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
}

interface Props {
  locale: string
  onLinked: () => void
}

export function LoginScreen({ locale, onLinked }: Props) {
  const [stage, setStage] = useState<'idle' | 'browser' | 'exchanging' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [apiBase, setApiBase] = useState('')

  useEffect(() => {
    electron()?.getApiBase?.().then(setApiBase).catch(() => {})
    electron()?.onLinkProgress?.((s) => {
      if (s === 'exchanging') setStage('exchanging')
    })
    electron()?.onLinkDone?.(({ ok }) => {
      if (ok) {
        setStage('idle')
        onLinked()
      }
    })
    electron()?.onLinkError?.(({ message }) => {
      setStage('error')
      setErrorMsg(message)
    })
  }, [onLinked])

  const startLinking = async () => {
    setErrorMsg('')
    setStage('browser')
    try {
      const res = await electron()?.startLinkFlow?.(locale)
      if (!res?.ok) {
        setStage('error')
        setErrorMsg('Tarayıcı açılamadı')
      }
    } catch (err) {
      setStage('error')
      setErrorMsg(String(err))
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 24,
      }}
    >
      <div
        className="titlebar"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44 }}
      />

      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          background: 'var(--color-primary-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--color-border-strong)',
        }}
      >
        <Sparkles size={28} style={{ color: 'var(--color-accent)' }} />
      </div>

      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          basvur.ai Live Copilot
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Mülakat sırasında gerçek zamanlı yardımcı. Devam etmek için basvur.ai hesabınla
          bağlan.
        </p>
      </div>

      <button
        onClick={startLinking}
        disabled={stage === 'browser' || stage === 'exchanging'}
        className="btn-accent no-drag"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 22px',
          fontSize: 14,
        }}
      >
        {stage === 'exchanging' ? (
          <>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            Bağlanılıyor…
          </>
        ) : stage === 'browser' ? (
          <>
            <ExternalLink size={16} />
            Tarayıcıda giriş yap
          </>
        ) : (
          <>
            <LogIn size={16} />
            basvur.ai ile giriş yap
          </>
        )}
      </button>

      {stage === 'browser' && (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          Tarayıcıda giriş yaptıktan sonra bu pencereye otomatik dönecek.
        </p>
      )}

      {stage === 'error' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid rgba(239,68,68,0.4)',
            background: 'rgba(239,68,68,0.12)',
            color: 'var(--color-danger)',
            fontSize: 12,
            maxWidth: 420,
          }}
        >
          <AlertCircle size={14} />
          <span>{errorMsg || 'Bilinmeyen hata'}</span>
        </div>
      )}

      {apiBase && (
        <p style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
          Sunucu: {apiBase}
        </p>
      )}
    </div>
  )
}
