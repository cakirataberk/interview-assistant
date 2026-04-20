/**
 * naudiodon2 (PortAudio) wrapper.
 *
 * Provides device enumeration and a thin readable-stream factory for raw
 * 16-bit PCM capture. Used by the listen pipeline (16kHz mono) and the
 * record route (44.1kHz mono).
 */
let portAudio = null
try {
  portAudio = require('naudiodon2')
} catch (err) {
  console.error('[audio] naudiodon2 module failed to load:', err.message)
}

function isAvailable() {
  return portAudio !== null
}

function listInputDevices() {
  if (!portAudio) return []
  try {
    const devices = portAudio.getDevices() || []
    return devices
      .filter((d) => (d.maxInputChannels || 0) > 0)
      .map((d) => ({ index: d.id, name: d.name }))
  } catch (err) {
    console.error('[audio] getDevices error:', err.message)
    return []
  }
}

function pickPreferredDeviceIndex(devices) {
  if (!devices || devices.length === 0) return 0
  const lower = (s) => String(s || '').toLowerCase()
  for (const d of devices) {
    if (lower(d.name).includes('blackhole')) return d.index
  }
  for (const d of devices) {
    const n = lower(d.name)
    if (n.includes('virtual') || n.includes('loopback') || n.includes('multi')) {
      return d.index
    }
  }
  return devices[0].index
}

/**
 * Open a PortAudio input stream. The returned object has the same surface
 * as a Node Readable: `.on('data', buf)`, `.start()`, `.quit(cb)`.
 *
 * Built-in mics on Apple Silicon (MacBook Air etc.) often return silence
 * when forced to 16 kHz — CoreAudio's HAL can't (or won't) resample for
 * every device. So callers should open at the device's native rate
 * (typically 48 kHz) and downsample afterwards via `downsample48to16()`.
 */
function openInputStream({ deviceId, sampleRate, channelCount = 1, framesPerBuffer = 512 }) {
  if (!portAudio) throw new Error('naudiodon2 unavailable')
  return portAudio.AudioIO({
    inOptions: {
      deviceId: deviceId ?? -1,
      sampleRate,
      channelCount,
      sampleFormat: portAudio.SampleFormat16Bit,
      framesPerBuffer,
      closeOnError: true,
    },
  })
}

/**
 * 3:1 average-decimation from 48 kHz to 16 kHz int16 mono.
 * Buffer in (48 kHz int16) → Buffer out (16 kHz int16). Adequate for
 * speech transcription; not suitable for high-fidelity audio.
 */
function downsample48to16(buf) {
  const inView = buf instanceof Int16Array
    ? buf
    : new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
  const outLen = Math.floor(inView.length / 3)
  const outBuf = Buffer.allocUnsafe(outLen * 2)
  const outView = new Int16Array(outBuf.buffer, outBuf.byteOffset, outLen)
  for (let i = 0; i < outLen; i++) {
    const j = i * 3
    outView[i] = ((inView[j] + inView[j + 1] + inView[j + 2]) / 3) | 0
  }
  return outBuf
}

module.exports = {
  isAvailable,
  listInputDevices,
  pickPreferredDeviceIndex,
  openInputStream,
  downsample48to16,
}
