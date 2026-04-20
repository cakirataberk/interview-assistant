const { Router } = require('express')
const sessionStore = require('../lib/sessionStore.cjs')
const listenManager = require('../lib/listenManager.cjs')

const router = Router()

router.post('/listen/start', (req, res) => {
  if (!sessionStore.getJwt()) {
    return res.json({ error: 'no_active_session' })
  }
  const body = req.body || {}
  const deviceIndex = Number.isFinite(body.device_index) ? body.device_index : 0
  const mode = body.transcription_mode || 'TR + ENG (Mixed)'

  try {
    listenManager.start({ deviceIndex, mode })
  } catch (err) {
    return res.status(500).json({ error: 'listen_start_failed', detail: err.message })
  }
  res.json({ ok: true })
})

router.post('/listen/stop', (_req, res) => {
  listenManager.stop()
  res.json({ ok: true })
})

module.exports = router
