/**
 * Streams suggestions from basvur.ai /api/interview/suggest.
 *
 * The desktop app never holds the Gemini key — it only carries a short-lived
 * session JWT (issued on /session/start). All errors are normalized into
 * AIProxyError with a stable `code` so callers can branch deterministically:
 *
 *   unauthorized   — session JWT expired/invalid (401)
 *   trial_expired  — FREE quota exhausted (403)
 *   proxy_error    — any other non-200
 *   ai_failed      — error event embedded in the SSE stream
 */

class AIProxyError extends Error {
  constructor(code, { status = 0, detail = '' } = {}) {
    super(`${code} (${status}): ${detail}`)
    this.code = code
    this.status = status
    this.detail = detail
  }
}

async function* _readSseLines(reader) {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '')
      buffer = buffer.slice(idx + 1)
      yield line
    }
  }
  if (buffer) yield buffer
}

/**
 * Yields text chunks until the upstream signals `{done:true}`.
 * Throws AIProxyError on auth / quota / server / payload failure.
 */
async function* streamSuggest({
  question,
  sessionJwt,
  apiBase,
  history = [],
  locale = 'tr',
}) {
  const url = `${apiBase.replace(/\/$/, '')}/api/interview/suggest`
  const payload = {
    question,
    history: history.slice(-5).map((h) => ({ q: h.q, a: h.a })),
    locale,
  }

  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionJwt}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    throw new AIProxyError('proxy_error', { status: 0, detail: err.message })
  }

  if (resp.status === 401) {
    throw new AIProxyError('unauthorized', { status: 401, detail: 'session expired' })
  }
  if (resp.status === 403) {
    throw new AIProxyError('trial_expired', { status: 403, detail: 'quota exhausted' })
  }
  if (resp.status !== 200 || !resp.body) {
    let detail = ''
    try { detail = (await resp.text()).slice(0, 200) } catch {}
    throw new AIProxyError('proxy_error', { status: resp.status, detail })
  }

  const reader = resp.body.getReader()
  try {
    for await (const line of _readSseLines(reader)) {
      if (!line || !line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      let evt
      try { evt = JSON.parse(raw) } catch { continue }

      if (evt.error) {
        throw new AIProxyError(String(evt.error), {
          status: 200,
          detail: String(evt.detail || ''),
        })
      }
      if (evt.done) return
      if (evt.text) yield evt.text
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
}

module.exports = { streamSuggest, AIProxyError }
