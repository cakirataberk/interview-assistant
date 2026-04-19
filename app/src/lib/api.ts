const BASE = 'http://127.0.0.1:7432'

export type AppConfigRemote = {
  window_alpha: number
  microphone_device_index: number
  transcription_mode: string
  api_base: string
  locale: string
  has_device_token: boolean
}

export type JobOption = {
  id: string
  jobTitle: string
  company: string | null
  jobDescription: string
  status: string | null
}

export type ActiveSession = {
  sessionId: string
  plan: 'FREE' | 'PRO'
  secondsRemaining: number
  jobTitle: string
  company: string
  locale: string
}

export async function getConfig(): Promise<AppConfigRemote> {
  const r = await fetch(`${BASE}/config`)
  return r.json()
}

export async function saveConfig(data: Record<string, unknown>) {
  const r = await fetch(`${BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return r.json()
}

export async function getDevices(): Promise<{ index: number; name: string }[]> {
  const r = await fetch(`${BASE}/devices`)
  return r.json()
}

export async function authLogout() {
  const r = await fetch(`${BASE}/auth/logout`, { method: 'POST' })
  return r.json()
}

export async function getJobs(): Promise<{ jobs: JobOption[] } | { error: string }> {
  const r = await fetch(`${BASE}/jobs`)
  return r.json()
}

export type SessionStartResponse =
  | {
      ok: true
      sessionId: string
      plan: 'FREE' | 'PRO'
      secondsRemaining: number
      jobTitle: string
      company: string
    }
  | { error: string; detail?: string; status?: number }

export async function startSession(params: {
  jobMatchId?: string | null
  customJdSnippet?: string | null
  customJdTitle?: string | null
  customJdCompany?: string | null
}): Promise<SessionStartResponse> {
  const r = await fetch(`${BASE}/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobMatchId: params.jobMatchId ?? null,
      customJdSnippet: params.customJdSnippet ?? null,
      customJdTitle: params.customJdTitle ?? null,
      customJdCompany: params.customJdCompany ?? null,
    }),
  })
  return r.json()
}

export async function endSession() {
  const r = await fetch(`${BASE}/session/end`, { method: 'POST' })
  return r.json()
}

export type GetSessionResponse =
  | { active: false }
  | {
      active: true
      sessionId: string
      plan: 'FREE' | 'PRO'
      secondsRemaining: number
      jobTitle: string
      company: string
      locale: string
    }

export async function getSession(): Promise<GetSessionResponse> {
  const r = await fetch(`${BASE}/session`)
  return r.json()
}

export async function startListening(deviceIndex: number, transcriptionMode: string) {
  const r = await fetch(`${BASE}/listen/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_index: deviceIndex, transcription_mode: transcriptionMode }),
  })
  return r.json()
}

export async function stopListening() {
  const r = await fetch(`${BASE}/listen/stop`, { method: 'POST' })
  return r.json()
}

export async function clearHistory() {
  const r = await fetch(`${BASE}/history/clear`, { method: 'POST' })
  return r.json()
}

export async function startRecording(deviceIndex: number) {
  const r = await fetch(`${BASE}/record/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_index: deviceIndex }),
  })
  return r.json()
}

export async function stopRecording() {
  const r = await fetch(`${BASE}/record/stop`, { method: 'POST' })
  return r.json()
}
