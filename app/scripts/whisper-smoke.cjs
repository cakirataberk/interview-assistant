#!/usr/bin/env node
/**
 * Smoke test for the whisper.cjs wrapper.
 *
 * Reads a 16kHz mono PCM WAV file, transcribes it with the requested language,
 * and prints the result.
 *
 * Usage:
 *   WHISPER_MODEL_PATH=../models/ggml-tiny.bin node scripts/whisper-smoke.cjs
 *
 * Default WAV files are looked up at /tmp/tr.wav and /tmp/en.wav (generated
 * via macOS `say` + `afconvert` — see plan).
 */
const fs = require('fs')
const path = require('path')

const TR_WAV = process.env.TR_WAV || '/tmp/tr.wav'
const EN_WAV = process.env.EN_WAV || '/tmp/en.wav'

function readPcmFromWav(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf.slice(0, 4).toString() !== 'RIFF' || buf.slice(8, 12).toString() !== 'WAVE') {
    throw new Error(`${filePath} is not a RIFF/WAVE file`)
  }
  let offset = 12
  let fmt = null
  let dataStart = -1
  let dataLen = 0
  while (offset < buf.length - 8) {
    const id = buf.slice(offset, offset + 4).toString()
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(offset + 8),
        numChannels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      }
    } else if (id === 'data') {
      dataStart = offset + 8
      dataLen = size
      break
    }
    offset += 8 + size + (size & 1)
  }
  if (!fmt || dataStart < 0) throw new Error(`malformed WAV: ${filePath}`)
  if (fmt.sampleRate !== 16000) {
    console.warn(`[smoke] WARN ${filePath} sample rate is ${fmt.sampleRate}, expected 16000`)
  }
  if (fmt.numChannels !== 1) {
    console.warn(`[smoke] WARN ${filePath} channels=${fmt.numChannels}, expected 1`)
  }
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`[smoke] ${filePath} has ${fmt.bitsPerSample}-bit samples, expected 16`)
  }
  return Buffer.from(buf.buffer, buf.byteOffset + dataStart, dataLen)
}

async function main() {
  const whisper = require('../electron/server/lib/whisper.cjs')

  if (!whisper.isAvailable()) {
    console.error('FAIL: smart-whisper module did not load')
    process.exit(1)
  }

  const t0 = Date.now()
  await whisper.preload((evt) => {
    console.log(`[whisper] ${evt.stage} ${evt.path || ''}`)
  })
  console.log(`[whisper] model loaded in ${Date.now() - t0}ms (path=${whisper.getLoadedModelPath()})`)

  const cases = [
    { lang: 'tr', wav: TR_WAV, expectedHint: 'merhaba' },
    { lang: 'en', wav: EN_WAV, expectedHint: 'hello' },
  ]

  for (const c of cases) {
    if (!fs.existsSync(c.wav)) {
      console.warn(`[smoke] skip ${c.lang}: ${c.wav} missing`)
      continue
    }
    const pcm = readPcmFromWav(c.wav)
    const t1 = Date.now()
    const text = await whisper.transcribe(pcm, { language: c.lang })
    const dur = Date.now() - t1
    const ok = text.toLowerCase().includes(c.expectedHint.toLowerCase())
    console.log(`[${c.lang}] ${dur}ms ${ok ? '✓' : '✗'} → "${text}"`)
  }

  await whisper.shutdown()
  console.log('[whisper] shutdown complete')
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
