const { Router } = require('express')
const { saveConfig, loadConfig } = require('../lib/config.cjs')
const sessionStore = require('../lib/sessionStore.cjs')
const conversationHistory = require('../lib/conversationHistory.cjs')
const heartbeat = require('../lib/heartbeat.cjs')
const listenManager = require('../lib/listenManager.cjs')

const router = Router()

router.post('/auth/token', (req, res) => {
  const token = String(req.body?.device_token || '').trim()
  if (!token) {
    return res.status(400).json({ error: 'missing token' })
  }
  saveConfig({ device_token: token })
  res.json({ ok: true })
})

router.post('/auth/logout', async (_req, res) => {
  const jwt = sessionStore.getJwt()
  const apiBase = (loadConfig().api_base || '').replace(/\/$/, '')

  listenManager.stop()
  heartbeat.stop()

  if (jwt) {
    try {
      await fetch(`${apiBase}/api/interview/session/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      })
    } catch {}
  }

  sessionStore.clear()
  conversationHistory.clear()
  saveConfig({ device_token: '' })

  res.json({ ok: true })
})

module.exports = router
