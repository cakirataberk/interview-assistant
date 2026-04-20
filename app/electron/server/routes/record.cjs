const { Router } = require('express')
const fs = require('fs')
const path = require('path')
const os = require('os')
const audio = require('../lib/audio.cjs')

const router = Router()

const RECORD_SAMPLE_RATE = 44100
const RECORD_CHANNELS = 1
const RECORD_FRAMES_PER_BUFFER = 1024

let stream = null
let chunks = []
let activeFile = null

function _recordingsDir() {
  const dir = path.join(os.homedir(), '.interview_assistant', 'recordings')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function _timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

function _writeWav(filePath, pcm, sampleRate, channels) {
  const byteRate = sampleRate * channels * 2
  const blockAlign = channels * 2
  const dataSize = pcm.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]))
}

router.post('/record/start', (req, res) => {
  if (stream) return res.json({ error: 'already recording' })
  if (!audio.isAvailable()) {
    return res.status(500).json({ error: 'audio_capture_unavailable' })
  }

  const body = req.body || {}
  const deviceIndex = Number.isFinite(body.device_index) ? body.device_index : 0

  activeFile = path.join(_recordingsDir(), `recording_${_timestamp()}.wav`)
  chunks = []

  try {
    stream = audio.openInputStream({
      deviceId: deviceIndex,
      sampleRate: RECORD_SAMPLE_RATE,
      channelCount: RECORD_CHANNELS,
      framesPerBuffer: RECORD_FRAMES_PER_BUFFER,
    })
    stream.on('data', (buf) => chunks.push(buf))
    stream.on('error', (err) => console.error('[record] stream error:', err.message))
    stream.start()
  } catch (err) {
    stream = null
    return res.status(500).json({ error: 'record_start_failed', detail: err.message })
  }

  res.json({ ok: true, file: activeFile })
})

router.post('/record/stop', (_req, res) => {
  const file = activeFile
  if (!stream) return res.json({ ok: true, file })

  const s = stream
  stream = null
  s.removeAllListeners('data')
  try {
    s.quit(() => {
      try {
        if (chunks.length > 0 && file) {
          _writeWav(file, Buffer.concat(chunks), RECORD_SAMPLE_RATE, RECORD_CHANNELS)
        }
      } catch (err) {
        console.error('[record] write error:', err.message)
      }
      chunks = []
      activeFile = null
      res.json({ ok: true, file })
    })
  } catch (err) {
    chunks = []
    activeFile = null
    res.status(500).json({ error: 'record_stop_failed', detail: err.message })
  }
})

module.exports = router
