/**
 * Orchestrates a single live-listening session: PortAudio → VAD → whisper →
 * WS broadcast. Only one stream is active at a time (any new start() tears
 * down the previous one).
 */
const audio = require('./audio.cjs')
const whisper = require('./whisper.cjs')
const ws = require('../ws.cjs')
const heartbeat = require('./heartbeat.cjs')
const { createVAD, SAMPLE_RATE, CHUNK_FRAMES } = require('./vad.cjs')

let stream = null
let vad = null
let pendingTranscriptions = 0

const MODE_TO_LANG = {
  'TR + ENG (Mixed)': null,
  'Türkçe': 'tr',
  TR: 'tr',
  English: 'en',
  EN: 'en',
}

function _modeToLang(mode) {
  if (!mode) return null
  if (mode in MODE_TO_LANG) return MODE_TO_LANG[mode]
  const v = String(mode).trim().toLowerCase()
  if (v === 'tr' || v.includes('türk')) return 'tr'
  if (v === 'en' || v.includes('english')) return 'en'
  if (v.includes('mixed') || v === 'auto') return null
  return null
}

async function _runTranscription(pcm, language, isPartial) {
  pendingTranscriptions += 1
  ws.broadcast({ type: 'status', text: 'transcribing…' })
  try {
    const text = await whisper.transcribe(pcm, { language, isPartial })
    if (text && text.trim()) {
      ws.broadcast({
        type: isPartial ? 'partial' : 'transcription',
        text: text.trim(),
      })
    } else if (!isPartial) {
      ws.broadcast({ type: 'status', text: 'silence' })
    }
  } catch (err) {
    console.error('[listen] transcribe error:', err)
    ws.broadcast({ type: 'status', text: `transcription error: ${err.message}` })
  } finally {
    pendingTranscriptions -= 1
  }
}

function _teardownStream() {
  if (!stream) return
  const s = stream
  stream = null
  try {
    s.removeAllListeners('data')
    s.removeAllListeners('error')
  } catch {}
  try {
    s.quit(() => {})
  } catch {
    try { s.abort?.() } catch {}
  }
}

function isListening() {
  return stream !== null
}

function start({ deviceIndex, mode }) {
  if (!audio.isAvailable()) {
    throw new Error('audio_capture_unavailable')
  }
  if (!whisper.isAvailable()) {
    throw new Error('whisper_unavailable')
  }

  stop()

  const language = _modeToLang(mode)

  vad = createVAD({
    onPartial: (pcm) => { _runTranscription(pcm, language, true) },
    onFinal: (pcm) => { _runTranscription(pcm, language, false) },
  })

  stream = audio.openInputStream({
    deviceId: deviceIndex,
    sampleRate: SAMPLE_RATE,
    channelCount: 1,
    framesPerBuffer: CHUNK_FRAMES,
  })

  stream.on('data', (buf) => {
    try { vad?.processChunk(buf) } catch (err) {
      console.error('[listen] vad error:', err)
    }
  })
  stream.on('error', (err) => {
    console.error('[listen] stream error:', err)
    ws.broadcast({ type: 'status', text: `audio error: ${err.message}` })
    stop()
  })

  try {
    stream.start()
  } catch (err) {
    _teardownStream()
    vad = null
    throw err
  }

  // Preload whisper in the background so the first segment isn't slow.
  whisper.preload((evt) => {
    if (evt.stage === 'loading') {
      ws.broadcast({ type: 'status', text: 'Loading whisper model…' })
    } else if (evt.stage === 'ready') {
      ws.broadcast({ type: 'status', text: 'ready' })
    }
  }).catch((err) => {
    ws.broadcast({ type: 'status', text: `whisper load error: ${err.message}` })
  })

  heartbeat.start()
  console.log(`[listen] started device=${deviceIndex} mode=${mode} lang=${language || 'auto'}`)
}

function stop() {
  if (!stream && !vad) {
    heartbeat.stop()
    return
  }
  _teardownStream()
  vad = null
  heartbeat.stop()
  console.log('[listen] stopped')
}

heartbeat.setForceStopHandler(() => stop())

module.exports = { start, stop, isListening }
