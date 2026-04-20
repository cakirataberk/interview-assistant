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

module.exports = {
  isAvailable,
  listInputDevices,
  pickPreferredDeviceIndex,
  openInputStream,
}
