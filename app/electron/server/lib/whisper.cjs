const fs = require('fs')
const path = require('path')

let Whisper = null
try {
  ({ Whisper } = require('smart-whisper'))
} catch (err) {
  console.error('[whisper] smart-whisper module failed to load:', err.message)
}

let modelInstance = null
let loadPromise = null
let loadedModelPath = null

const MODEL_FILENAME = process.env.WHISPER_MODEL_FILE || 'ggml-small.bin'

function _resolveModelPath() {
  if (process.env.WHISPER_MODEL_PATH && fs.existsSync(process.env.WHISPER_MODEL_PATH)) {
    return process.env.WHISPER_MODEL_PATH
  }
  const candidates = []
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'models', MODEL_FILENAME))
  }
  candidates.push(path.join(__dirname, '..', '..', '..', 'models', MODEL_FILENAME))
  candidates.push(path.join(__dirname, '..', '..', '..', '..', 'models', MODEL_FILENAME))

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function _int16ToFloat32(buf) {
  const int16 = buf instanceof Int16Array
    ? buf
    : new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
  const out = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768
  return out
}

function _normalizeLanguage(language) {
  if (!language) return null
  const v = String(language).trim().toLowerCase()
  if (v === 'auto' || v === 'mixed') return null
  return v
}

function isAvailable() {
  return Whisper !== null
}

function getLoadedModelPath() {
  return loadedModelPath
}

async function preload(onStatus) {
  if (modelInstance) return modelInstance
  if (loadPromise) return loadPromise
  if (!Whisper) throw new Error('smart-whisper module not available')

  const modelPath = _resolveModelPath()
  if (!modelPath) {
    const err = new Error(`Whisper model file not found (looked for ${MODEL_FILENAME})`)
    err.code = 'MODEL_NOT_FOUND'
    throw err
  }

  if (typeof onStatus === 'function') {
    onStatus({ stage: 'loading', path: modelPath })
  }

  loadPromise = (async () => {
    const inst = new Whisper(modelPath, { gpu: true, offload: 0 })
    await inst.load()
    modelInstance = inst
    loadedModelPath = modelPath
    if (typeof onStatus === 'function') {
      onStatus({ stage: 'ready', path: modelPath })
    }
    return inst
  })()

  try {
    return await loadPromise
  } finally {
    loadPromise = null
  }
}

async function transcribe(pcm, { language, isPartial = false } = {}) {
  if (!modelInstance) await preload()

  const float32 = pcm instanceof Float32Array ? pcm : _int16ToFloat32(pcm)
  if (float32.length === 0) return ''

  const lang = _normalizeLanguage(language)

  const params = {
    n_threads: 4,
    no_timestamps: true,
    single_segment: isPartial,
    suppress_blank: true,
    suppress_non_speech_tokens: true,
    print_progress: false,
    print_realtime: false,
    print_special: false,
    print_timestamps: false,
    temperature: 0,
  }
  if (lang) params.language = lang

  const task = await modelInstance.transcribe(float32, params)
  const results = await task.result
  return results.map((r) => r.text).join('').trim()
}

async function shutdown() {
  if (modelInstance) {
    try { await modelInstance.free() } catch {}
    modelInstance = null
    loadedModelPath = null
  }
}

module.exports = {
  preload,
  transcribe,
  shutdown,
  isAvailable,
  getLoadedModelPath,
}
