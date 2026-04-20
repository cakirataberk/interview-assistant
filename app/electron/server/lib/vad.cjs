/**
 * Energy-threshold VAD with partial + final segment emission.
 *
 * Behavioural port of backend.legacy/server.py:_stream_worker (lines 157-231).
 * Constants are intentionally identical so streaming feel matches the old
 * Python pipeline.
 *
 *   SAMPLE_RATE        16000   Hz, mono int16
 *   CHUNK_FRAMES       512     samples per upstream read (~32 ms)
 *   ENERGY_THRESH      300     RMS gate (matches Python int16 magnitude)
 *   PARTIAL_CHUNKS     ~46     ≈1.5 s — emit a partial transcript every N speech chunks
 *   SILENCE_END_CHUNKS ~17     ≈0.55 s — close the segment after this many silent chunks
 */
const SAMPLE_RATE = 16000
const CHUNK_FRAMES = 512
const ENERGY_THRESH = 300
const PARTIAL_CHUNKS = Math.floor((1.5 * SAMPLE_RATE) / CHUNK_FRAMES)
const SILENCE_END_CHUNKS = Math.floor((0.55 * SAMPLE_RATE) / CHUNK_FRAMES)

function _rmsInt16(int16) {
  if (int16.length === 0) return 0
  let sumSq = 0
  for (let i = 0; i < int16.length; i++) {
    const s = int16[i]
    sumSq += s * s
  }
  return Math.sqrt(sumSq / int16.length)
}

function _toInt16View(buffer) {
  if (buffer instanceof Int16Array) return buffer
  return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2)
}

function _concatChunks(chunks) {
  const total = chunks.reduce((n, b) => n + b.length, 0)
  const out = Buffer.allocUnsafe(total)
  let offset = 0
  for (const b of chunks) {
    b.copy(out, offset)
    offset += b.length
  }
  return out
}

/**
 * Stateful detector. Caller streams int16 PCM Buffer chunks into
 * processChunk(); the detector invokes onPartial/onFinal with concatenated
 * PCM Buffers when boundaries are crossed.
 */
function createVAD({ onPartial, onFinal, energyThreshold = ENERGY_THRESH } = {}) {
  let speechBuf = []
  let windowBuf = []
  let silenceCount = 0
  let speaking = false

  function processChunk(buf) {
    const int16 = _toInt16View(buf)
    const energy = _rmsInt16(int16)

    if (energy > energyThreshold) {
      silenceCount = 0
      speaking = true
      speechBuf.push(buf)
      windowBuf.push(buf)

      if (windowBuf.length >= PARTIAL_CHUNKS) {
        const pcm = _concatChunks(windowBuf)
        windowBuf = []
        if (typeof onPartial === 'function') onPartial(pcm)
      }
      return
    }

    if (!speaking) return

    silenceCount += 1
    speechBuf.push(buf)
    if (silenceCount >= SILENCE_END_CHUNKS) {
      const pcm = _concatChunks(speechBuf)
      speechBuf = []
      windowBuf = []
      silenceCount = 0
      speaking = false
      if (typeof onFinal === 'function') onFinal(pcm)
    }
  }

  function reset() {
    speechBuf = []
    windowBuf = []
    silenceCount = 0
    speaking = false
  }

  return { processChunk, reset }
}

module.exports = {
  createVAD,
  SAMPLE_RATE,
  CHUNK_FRAMES,
  ENERGY_THRESH,
  PARTIAL_CHUNKS,
  SILENCE_END_CHUNKS,
}
