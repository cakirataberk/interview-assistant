const BASE = 'http://127.0.0.1:7432'

export async function getConfig() {
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

export async function getSuggestion(params: {
  question: string
  api_key: string
  cv: string
  job_description: string
  system_prompt: string
  user_prompt: string
}) {
  const r = await fetch(`${BASE}/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
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
