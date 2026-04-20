import { useEffect, useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import {
  getConfig,
  getSession,
  saveConfig,
  type AppConfigRemote,
  type ActiveSession,
} from './lib/api'
import { LoginScreen } from './components/LoginScreen'
import { SessionPickerScreen } from './components/SessionPickerScreen'
import { MainPanel } from './components/MainPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { OnboardingWizard } from './components/OnboardingWizard'
import './index.css'

type Screen = 'loading' | 'login' | 'picker' | 'main' | 'settings' | 'onboarding'

type ElectronAPI = {
  onBackendReady?: (cb: (r: boolean) => void) => void
  startLinkFlow?: (locale: string) => Promise<{ ok: boolean; state: string }>
  onLinkProgress?: (cb: (stage: string) => void) => void
  onLinkDone?: (cb: (data: { ok: boolean }) => void) => void
  onLinkError?: (cb: (data: { message: string }) => void) => void
  blackholeCheck?: () => Promise<boolean>
  setOpacity?: (v: number) => Promise<void>
  setAlwaysOnTop?: (v: boolean) => Promise<void>
}

function electron(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
}

const ONBOARDING_KEY = 'basvurai.onboardingComplete'

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [config, setConfig] = useState<AppConfigRemote | null>(null)
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [loadingMsg, setLoadingMsg] = useState('Arka plan hazırlanıyor…')

  const refreshConfig = useCallback(async (): Promise<AppConfigRemote | null> => {
    try {
      const c = await getConfig()
      setConfig(c)
      return c
    } catch {
      return null
    }
  }, [])

  const refreshSession = useCallback(async (): Promise<ActiveSession | null> => {
    try {
      const s = await getSession()
      if (s.active) {
        const active: ActiveSession = {
          sessionId: s.sessionId,
          plan: s.plan,
          secondsRemaining: s.secondsRemaining,
          jobTitle: s.jobTitle,
          company: s.company,
          locale: s.locale,
        }
        setSession(active)
        return active
      }
      setSession(null)
      return null
    } catch {
      setSession(null)
      return null
    }
  }, [])

  const bootstrap = useCallback(async () => {
    const c = await refreshConfig()
    if (!c) {
      setTimeout(bootstrap, 1000)
      return
    }
    const s = await refreshSession()
    const onboardingDone = localStorage.getItem(ONBOARDING_KEY) === '1'
    if (!c.has_device_token) {
      setScreen(onboardingDone ? 'login' : 'onboarding')
      return
    }
    if (s) {
      setScreen('main')
      return
    }
    setScreen('picker')
  }, [refreshConfig, refreshSession])

  useEffect(() => {
    let booted = false
    const tryBoot = () => {
      if (booted) return
      booted = true
      bootstrap()
    }

    const api = electron()
    api?.onBackendReady?.((ready) => {
      if (ready) tryBoot()
      else if (!booted) setLoadingMsg('Arka plan başlatılamadı. Uygulamayı yeniden başlat.')
    })

    // Always poll /health too — the backend-ready IPC can race with React mount
    // and silently drop the event. Polling is the source of truth.
    const poll = async () => {
      for (let i = 0; i < 60 && !booted; i++) {
        try {
          const r = await fetch('http://127.0.0.1:7432/health')
          if (r.ok) {
            tryBoot()
            return
          }
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      if (!booted) setLoadingMsg('Arka plan bulunamadı.')
    }
    poll()
  }, [bootstrap])

  // Link flow listeners — applies once per app lifetime
  useEffect(() => {
    const api = electron()
    api?.onLinkDone?.(async ({ ok }) => {
      if (ok) {
        await refreshConfig()
        setScreen('picker')
      }
    })
    api?.onLinkError?.(({ message }) => {
      console.error('link error', message)
    })
  }, [refreshConfig])

  const handleLogout = useCallback(async () => {
    setSession(null)
    await refreshConfig()
    setScreen('login')
  }, [refreshConfig])

  const handleSessionStarted = useCallback(async () => {
    await refreshSession()
    setScreen('main')
  }, [refreshSession])

  const handleSessionEnded = useCallback(async () => {
    setSession(null)
    setScreen('picker')
  }, [])

  const handleConfigChange = useCallback(
    async (updates: Partial<AppConfigRemote>) => {
      const payload: Record<string, unknown> = { ...updates }
      await saveConfig(payload)
      if (updates.window_alpha !== undefined) {
        await electron()?.setOpacity?.(updates.window_alpha)
      }
      await refreshConfig()
    },
    [refreshConfig],
  )

  if (screen === 'loading' || !config) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 12,
        }}
      >
        <div
          className="titlebar"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44 }}
        />
        <Loader2
          size={28}
          style={{ color: 'var(--color-primary-hover)', animation: 'spin 1s linear infinite' }}
        />
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{loadingMsg}</span>
      </div>
    )
  }

  if (screen === 'onboarding') {
    return (
      <OnboardingWizard
        onComplete={async () => {
          localStorage.setItem(ONBOARDING_KEY, '1')
          await refreshConfig()
          const c = config
          if (c?.has_device_token) setScreen('picker')
          else setScreen('login')
        }}
      />
    )
  }

  if (screen === 'login') {
    return (
      <LoginScreen
        locale={config.locale}
        onLinked={async () => {
          await refreshConfig()
          setScreen('picker')
        }}
      />
    )
  }

  if (screen === 'picker') {
    return (
      <SessionPickerScreen
        locale={config.locale}
        onSessionStarted={handleSessionStarted}
        onOpenSettings={() => setScreen('settings')}
        onLogout={handleLogout}
        onConfigChange={handleConfigChange}
      />
    )
  }

  if (screen === 'settings') {
    return (
      <SettingsPanel
        config={config}
        session={session}
        onChange={handleConfigChange}
        onBack={() => setScreen(session ? 'main' : 'picker')}
        onLogout={handleLogout}
      />
    )
  }

  // main
  if (!session) {
    // No session but routed to main: recover
    setScreen('picker')
    return null
  }
  return (
    <MainPanel
      config={config}
      session={session}
      onOpenSettings={() => setScreen('settings')}
      onSessionEnded={handleSessionEnded}
    />
  )
}
