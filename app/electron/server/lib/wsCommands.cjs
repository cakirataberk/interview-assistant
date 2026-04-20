/**
 * WebSocket command dispatcher. The desktop renderer can either issue
 * `{cmd:'ping'}` for keepalive or `{cmd:'suggest', question}` to get a
 * streaming AI suggestion without going through HTTP/SSE — chunks come
 * back as `{type:'suggestion_chunk', text}` and end with
 * `{type:'suggestion_done', history_count}`.
 */
const sessionStore = require('./sessionStore.cjs')
const conversationHistory = require('./conversationHistory.cjs')
const listenManager = require('./listenManager.cjs')
const { loadConfig } = require('./config.cjs')
const { streamSuggest, AIProxyError } = require('./sseProxy.cjs')

function _apiBase() {
  return (loadConfig().api_base || '').replace(/\/$/, '')
}

function _safeSend(socket, payload) {
  if (socket.readyState !== 1) return
  try { socket.send(JSON.stringify(payload)) } catch {}
}

async function handleSuggest(socket, body) {
  const question = String(body?.question || '').trim()
  if (!question) {
    _safeSend(socket, { type: 'suggestion_error', text: 'missing question' })
    return
  }

  const jwt = sessionStore.getJwt()
  if (!jwt) {
    _safeSend(socket, { type: 'suggestion_error', text: 'no_active_session' })
    return
  }

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
      _safeSend(socket, { type: 'suggestion_chunk', text: chunk })
    }
  } catch (err) {
    if (err instanceof AIProxyError) {
      _safeSend(socket, { type: 'suggestion_error', text: err.code, detail: err.detail })
      if (err.code === 'unauthorized' || err.code === 'trial_expired') {
        listenManager.stop()
      }
    } else {
      _safeSend(socket, { type: 'suggestion_error', text: `AI error: ${err.message}` })
    }
    return
  }

  const fullText = collected.join('')
  if (fullText) conversationHistory.append(question, fullText)
  _safeSend(socket, { type: 'suggestion_done', history_count: conversationHistory.count() })
}

function handleMessage(socket, raw) {
  let msg
  try { msg = JSON.parse(raw) } catch { return }
  const cmd = msg?.cmd
  if (cmd === 'ping') {
    _safeSend(socket, { type: 'pong' })
  } else if (cmd === 'suggest') {
    handleSuggest(socket, msg).catch((err) => {
      console.error('[ws] suggest error:', err)
      _safeSend(socket, { type: 'suggestion_error', text: `AI error: ${err.message}` })
    })
  }
}

module.exports = { handleMessage }
