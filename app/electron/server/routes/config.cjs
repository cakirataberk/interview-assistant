const { Router } = require('express')
const { loadConfig, saveConfig } = require('../lib/config.cjs')

const router = Router()

const PUBLIC_FIELDS = [
  'window_alpha',
  'microphone_device_index',
  'transcription_mode',
  'api_base',
  'locale',
]

const WRITABLE_FIELDS = [
  'window_alpha',
  'microphone_device_index',
  'transcription_mode',
  'locale',
]

function publicView(cfg) {
  const out = {}
  for (const k of PUBLIC_FIELDS) out[k] = cfg[k]
  out.has_device_token = Boolean(cfg.device_token)
  return out
}

router.get('/config', (_req, res) => {
  res.json(publicView(loadConfig()))
})

router.post('/config', (req, res) => {
  const body = req.body || {}
  const partial = {}
  for (const k of WRITABLE_FIELDS) {
    if (k in body) partial[k] = body[k]
  }
  const next = saveConfig(partial)
  res.json(publicView(next))
})

module.exports = router
