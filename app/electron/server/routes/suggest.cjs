const { Router } = require('express')
const sessionStore = require('../lib/sessionStore.cjs')
const conversationHistory = require('../lib/conversationHistory.cjs')
const listenManager = require('../lib/listenManager.cjs')
const { loadConfig } = require('../lib/config.cjs')
const { streamSuggest, AIProxyError } = require('../lib/sseProxy.cjs')

const router = Router()

function _apiBase() {
  return (loadConfig().api_base || '').replace(/\/$/, '')
}

function _sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

router.post('/suggest/stream', async (req, res) => {
  const question = String(req.body?.question || '').trim()
  if (!question) {
    return res.json({ error: 'question is empty' })
  }

  const jwt = sessionStore.getJwt()
  if (!jwt) {
    return res.json({ error: 'no_active_session' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const collected = []
  try {
    for await (const chunk of streamSuggest({
      question,
      sessionJwt: jwt,
      apiBase: _apiBase(),
      history: conversationHistory.list(),
      locale: sessionStore.getLocale(),
    })) {
      collected.push(chunk)
      _sse(res, { text: chunk })
    }
  } catch (err) {
    if (err instanceof AIProxyError) {
      _sse(res, { error: err.code, detail: err.detail })
      if (err.code === 'unauthorized' || err.code === 'trial_expired') {
        listenManager.stop()
      }
    } else {
      _sse(res, { error: 'ai_failed', detail: err.message })
    }
    return res.end()
  }

  const fullText = collected.join('')
  if (fullText) conversationHistory.append(question, fullText)
  _sse(res, { done: true, history_count: conversationHistory.count() })
  res.end()
})

router.post('/history/clear', (_req, res) => {
  conversationHistory.clear()
  res.json({ ok: true })
})

module.exports = router
