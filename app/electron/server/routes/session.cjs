const { Router } = require('express')
const { loadConfig } = require('../lib/config.cjs')
const sessionStore = require('../lib/sessionStore.cjs')
const conversationHistory = require('../lib/conversationHistory.cjs')
const heartbeat = require('../lib/heartbeat.cjs')

const router = Router()

function _apiBase() {
  return (loadConfig().api_base || '').replace(/\/$/, '')
}

router.post('/session/start', async (req, res) => {
  const cfg = loadConfig()
  const token = cfg.device_token
  if (!token) return res.status(401).json({ error: 'unauthorized' })

  const body = req.body || {}
  const payload = {
    jobMatchId: body.jobMatchId || null,
    customJdSnippet: body.customJdSnippet || null,
    customJdTitle: body.customJdTitle || null,
    customJdCompany: body.customJdCompany || null,
    locale: cfg.locale || 'tr',
  }

  let upstream
  try {
    upstream = await fetch(`${_apiBase()}/api/interview/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    return res.status(502).json({ error: 'proxy', detail: err.message })
  }

  if (upstream.status === 401) return res.json({ error: 'unauthorized' })
  if (upstream.status === 403) {
    let extra = {}
    try { extra = await upstream.json() } catch {}
    return res.json({ error: 'trial_expired', ...extra })
  }
  if (upstream.status !== 200) {
    return res.json({ error: 'proxy', status: upstream.status })
  }

  const data = await upstream.json()
  sessionStore.set({
    sessionJwt: data.sessionJwt,
    sessionId: data.sessionId,
    cv: data.cv || '',
    jobDescription: data.jobDescription || '',
    jobTitle: data.jobTitle || '',
    company: data.company || '',
    plan: data.plan,
    secondsRemaining: data.secondsRemaining,
    locale: data.locale || 'tr',
  })
  conversationHistory.clear()

  res.json({
    ok: true,
    sessionId: data.sessionId,
    plan: data.plan,
    secondsRemaining: data.secondsRemaining,
    jobTitle: data.jobTitle || '',
    company: data.company || '',
  })
})

router.post('/session/end', async (_req, res) => {
  heartbeat.stop()
  const jwt = sessionStore.getJwt()
  if (jwt) {
    try {
      await fetch(`${_apiBase()}/api/interview/session/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      })
    } catch {}
  }
  sessionStore.clear()
  res.json({ ok: true })
})

router.get('/session', (_req, res) => {
  const session = sessionStore.get()
  if (!session) return res.json({ active: false })
  res.json({
    active: true,
    sessionId: session.sessionId,
    plan: session.plan,
    secondsRemaining: session.secondsRemaining,
    jobTitle: session.jobTitle || '',
    company: session.company || '',
    locale: session.locale || 'tr',
  })
})

module.exports = router
