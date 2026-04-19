import { useEffect, useState } from 'react'
import {
  Sparkles,
  Mic,
  Radio,
  CheckCircle2,
  ArrowRight,
  Loader2,
  AlertCircle,
} from 'lucide-react'

type ElectronAPI = {
  blackholeCheck?: () => Promise<boolean>
  blackholeInstall?: () => Promise<{ ok: boolean }>
  onBlackholeProgress?: (cb: (data: { status: string; detail: string }) => void) => void
}

function electron(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
}

type Step = 'welcome' | 'mic' | 'blackhole' | 'done'

interface Props {
  onComplete: () => void
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const [micState, setMicState] = useState<'idle' | 'asking' | 'granted' | 'denied'>('idle')
  const [bhState, setBhState] = useState<'unknown' | 'checking' | 'installed' | 'missing' | 'installing' | 'error'>('unknown')
  const [bhLog, setBhLog] = useState('')

  useEffect(() => {
    electron()?.onBlackholeProgress?.((data) => {
      if (data.status === 'progress' && data.detail) setBhLog(data.detail.slice(-120))
      else if (data.status === 'done') setBhState('installed')
      else if (data.status === 'error') { setBhState('error'); setBhLog(data.detail) }
    })
    electron()?.blackholeCheck?.().then((ok) => setBhState(ok ? 'installed' : 'missing')).catch(() => {})
  }, [])

  const requestMic = async () => {
    setMicState('asking')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMicState('granted')
    } catch {
      setMicState('denied')
    }
  }

  const installBH = async () => {
    setBhState('installing')
    setBhLog('')
    await electron()?.blackholeInstall?.()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div
        className="titlebar"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44 }}
      />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '64px 32px 32px',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: '100%', maxWidth: 520 }}>
          <Stepper current={step} />

          {step === 'welcome' && (
            <StepCard
              icon={<Sparkles size={22} style={{ color: 'var(--color-accent)' }} />}
              title="basvur.ai Live Copilot"
              subtitle="Mülakat sırasında gerçek zamanlı AI destek. 3 kısa adımda kurulum yapalım."
            >
              <ul style={bulletList}>
                <li>• CV'ne göre uyarlanmış cevaplar</li>
                <li>• Zoom / Meet / Teams sesini yakalama</li>
                <li>• Teleprompter modu + gizli pencere</li>
              </ul>
              <button
                onClick={() => setStep('mic')}
                className="btn-accent"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 20 }}
              >
                Başlayalım <ArrowRight size={14} />
              </button>
            </StepCard>
          )}

          {step === 'mic' && (
            <StepCard
              icon={<Mic size={22} style={{ color: 'var(--color-primary-hover)' }} />}
              title="Mikrofon erişimi"
              subtitle="Sesi transkribe edebilmek için tek seferlik izin gerekiyor. macOS sana bir diyalog gösterecek."
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'var(--color-surface-solid)',
                  border: '1px solid var(--color-border-strong)',
                  marginBottom: 16,
                  fontSize: 13,
                  color: 'var(--color-text-muted)',
                }}
              >
                {micState === 'granted' ? (
                  <><CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} /> Erişim verildi</>
                ) : micState === 'denied' ? (
                  <><AlertCircle size={16} style={{ color: 'var(--color-danger)' }} /> Reddedildi — Sistem Ayarları → Gizlilik'ten açabilirsin.</>
                ) : micState === 'asking' ? (
                  <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Bekleniyor…</>
                ) : (
                  'Henüz izin istenmedi.'
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {micState !== 'granted' && (
                  <button
                    onClick={requestMic}
                    disabled={micState === 'asking'}
                    className="btn-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    {micState === 'asking' && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                    İzin iste
                  </button>
                )}
                <button
                  onClick={() => setStep('blackhole')}
                  className="btn-ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  Devam <ArrowRight size={14} />
                </button>
              </div>
            </StepCard>
          )}

          {step === 'blackhole' && (
            <StepCard
              icon={<Radio size={22} style={{ color: 'var(--color-accent)' }} />}
              title="BlackHole (toplantı sesi)"
              subtitle="Zoom / Meet / Teams sesini duyabilmek için gereken ücretsiz sistem driver'ı. Şimdi kurabilir ya da sonraya bırakabilirsin."
            >
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'var(--color-surface-solid)',
                  border: '1px solid var(--color-border-strong)',
                  marginBottom: 12,
                  fontSize: 13,
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                {bhState === 'installed' ? (
                  <><CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} /> Yüklü</>
                ) : bhState === 'missing' ? (
                  <><AlertCircle size={16} style={{ color: 'var(--color-warning)' }} /> Yüklü değil</>
                ) : bhState === 'installing' ? (
                  <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Kuruluyor… (1–2 dk)</>
                ) : bhState === 'error' ? (
                  <><AlertCircle size={16} style={{ color: 'var(--color-danger)' }} /> {bhLog || 'Kurulum başarısız'}</>
                ) : (
                  'Kontrol ediliyor…'
                )}
              </div>

              {bhState === 'installed' && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(245,158,11,0.35)',
                    background: 'rgba(245,158,11,0.1)',
                    color: 'var(--color-warning)',
                    fontSize: 12,
                    lineHeight: 1.55,
                    marginBottom: 12,
                  }}
                >
                  ⚠ BlackHole'u ilk kez kurduysan sistemi yeniden başlat. Sonra Audio MIDI
                  Setup'ta Multi-Output Device oluştur (hem hoparlörün hem BlackHole 2ch işaretli
                  olacak) ve macOS ses çıkışını bu multi-output cihaza ayarla.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                {(bhState === 'missing' || bhState === 'error') && (
                  <button
                    onClick={installBH}
                    className="btn-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Radio size={14} /> Şimdi kur
                  </button>
                )}
                <button
                  onClick={() => setStep('done')}
                  className="btn-ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {bhState === 'installed' ? 'Devam' : 'Şimdi atla'} <ArrowRight size={14} />
                </button>
              </div>
            </StepCard>
          )}

          {step === 'done' && (
            <StepCard
              icon={<CheckCircle2 size={22} style={{ color: 'var(--color-success)' }} />}
              title="Hazırsın"
              subtitle="Artık basvur.ai hesabınla bağlanıp ilk mülakat oturumunu başlatabilirsin."
            >
              <button
                onClick={onComplete}
                className="btn-accent"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12 }}
              >
                basvur.ai ile bağlan <ArrowRight size={14} />
              </button>
            </StepCard>
          )}
        </div>
      </div>
    </div>
  )
}

function Stepper({ current }: { current: Step }) {
  const order: Step[] = ['welcome', 'mic', 'blackhole', 'done']
  const idx = order.indexOf(current)
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
      {order.map((s, i) => (
        <div
          key={s}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 999,
            background: i <= idx ? 'var(--color-accent)' : 'var(--color-border)',
            transition: 'background 200ms',
          }}
        />
      ))}
    </div>
  )
}

function StepCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="card no-drag" style={{ padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'var(--color-surface-solid)',
            border: '1px solid var(--color-border-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        <div>
          <p style={{ fontSize: 18, fontWeight: 700 }}>{title}</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>basvur.ai</p>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 18 }}>
        {subtitle}
      </p>
      {children}
    </div>
  )
}

const bulletList: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  color: 'var(--color-text)',
}
