const ws = require('../ws.cjs')
const sessionStore = require('./sessionStore.cjs')
const { loadConfig } = require('./config.cjs')

const INTERVAL_MS = 30_000

let timer = null
let lastTickAt = 0
let listeningSince = 0
let forceStopHandler = null

function _now() {
  return Date.now() / 1000
}

function _apiBase() {
  return (loadConfig().api_base || '').replace(/\/$/, '')
}

async function _tick() {
  const jwt = sessionStore.getJwt()
  if (!jwt || !listeningSince) return

  const now = _now()
  const seconds = Math.floor(now - Math.max(lastTickAt, listeningSince))
  if (seconds <= 0) return
  lastTickAt = now

  try {
    const r = await fetch(`${_apiBase()}/api/interview/session/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ secondsElapsed: seconds }),
    })

    if (r.status === 200) {
      const data = await r.json()
      const secondsRemaining = data.secondsRemaining ?? null
      const shouldStop = Boolean(data.shouldStop)

      sessionStore.updateSecondsRemaining(secondsRemaining)
      ws.broadcast({ type: 'quota', secondsRemaining, shouldStop })

      if (shouldStop) {
        ws.broadcast({ type: 'status', text: 'Trial süresi bitti' })
        if (forceStopHandler) forceStopHandler('trial_expired')
        stop()
      }
    } else if (r.status === 401) {
      ws.broadcast({ type: 'session_expired' })
      if (forceStopHandler) forceStopHandler('unauthorized')
      stop()
    } else {
      console.warn(`[heartbeat] status=${r.status}`)
    }
  } catch (err) {
    console.warn('[heartbeat] error:', err.message)
  }
}

function start() {
  stop()
  lastTickAt = _now()
  listeningSince = _now()
  timer = setInterval(() => { _tick() }, INTERVAL_MS)
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  listeningSince = 0
}

function isRunning() {
  return timer !== null
}

function setForceStopHandler(handler) {
  forceStopHandler = typeof handler === 'function' ? handler : null
}

module.exports = { start, stop, isRunning, setForceStopHandler }
