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

export async function streamSuggestion(
  params: {
    question: string
    api_key: string
    cv: string
    job_description: string
    system_prompt: string
    user_prompt: string
  },
  onChunk: (text: string) => void,
  onDone: (historyCount: number) => void,
  onError: (msg: string) => void,
) {
  let response: Response
  try {
    response = await fetch(`${BASE}/suggest/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  } catch {
    onError('Backend unreachable')
    return
  }

  const reader = response.body?.getReader()
  if (!reader) { onError('No stream'); return }
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6))
        if (data.text) onChunk(data.text)
        if (data.done) onDone(data.history_count ?? 0)
        if (data.error) onError(data.error)
      } catch { /* partial line */ }
    }
  }
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
