const { Router } = require('express')
const { loadConfig } = require('../lib/config.cjs')

const router = Router()

router.get('/jobs', async (_req, res) => {
  const cfg = loadConfig()
  const token = cfg.device_token
  if (!token) return res.status(401).json({ error: 'unauthorized' })

  const apiBase = (cfg.api_base || '').replace(/\/$/, '')
  try {
    const upstream = await fetch(`${apiBase}/api/interview/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (upstream.status !== 200) {
      return res.json({ error: 'proxy', status: upstream.status })
    }
    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: 'proxy', detail: err.message })
  }
})

module.exports = router
