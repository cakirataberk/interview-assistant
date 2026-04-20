#!/usr/bin/env node
/**
 * Downloads ggml whisper models from Hugging Face into ../models/
 *
 * Usage:
 *   node scripts/download-models.cjs              # downloads default (medium)
 *   node scripts/download-models.cjs tiny medium  # downloads multiple
 *   WHISPER_MODELS=tiny node scripts/download-models.cjs   # via env
 *
 * The download is skipped if the file already exists with the expected size
 * (so this is safe to invoke from npm hooks).
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

const MODEL_FILES = {
  tiny: { file: 'ggml-tiny.bin', sizeMB: 75 },
  'tiny.en': { file: 'ggml-tiny.en.bin', sizeMB: 75 },
  base: { file: 'ggml-base.bin', sizeMB: 142 },
  'base.en': { file: 'ggml-base.en.bin', sizeMB: 142 },
  small: { file: 'ggml-small.bin', sizeMB: 466 },
  'small.en': { file: 'ggml-small.en.bin', sizeMB: 466 },
  medium: { file: 'ggml-medium.bin', sizeMB: 1535 },
  'medium.en': { file: 'ggml-medium.en.bin', sizeMB: 1535 },
  'large-v3': { file: 'ggml-large-v3.bin', sizeMB: 3094 },
  'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', sizeMB: 1620 },
}

const MODELS_DIR = path.resolve(__dirname, '..', '..', 'models')

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function downloadOne(name) {
  const meta = MODEL_FILES[name]
  if (!meta) {
    console.error(`Unknown model: ${name}. Known: ${Object.keys(MODEL_FILES).join(', ')}`)
    process.exit(1)
  }

  const dest = path.join(MODELS_DIR, meta.file)
  const url = `${HF_BASE}/${meta.file}`

  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size
    const expected = meta.sizeMB * 1024 * 1024
    const tolerance = 0.05
    if (Math.abs(size - expected) / expected < tolerance) {
      console.log(`✓ ${meta.file} already exists (${fmtMB(size)}), skipping`)
      return Promise.resolve()
    }
    console.log(`! ${meta.file} exists but size ${fmtMB(size)} differs from expected ~${meta.sizeMB} MB, redownloading`)
    fs.unlinkSync(dest)
  }

  console.log(`↓ ${meta.file} (~${meta.sizeMB} MB) ...`)

  fs.mkdirSync(MODELS_DIR, { recursive: true })

  return new Promise((resolve, reject) => {
    const tmp = dest + '.part'
    const file = fs.createWriteStream(tmp)
    let received = 0
    let lastLog = Date.now()

    function fetchUrl(currentUrl, redirects = 0) {
      if (redirects > 5) {
        reject(new Error('too many redirects'))
        return
      }
      https.get(currentUrl, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          fetchUrl(res.headers.location, redirects + 1)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`))
          return
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        res.on('data', (chunk) => {
          received += chunk.length
          const now = Date.now()
          if (now - lastLog > 1000) {
            const pct = total ? ((received / total) * 100).toFixed(1) : '?'
            process.stdout.write(`\r  ${fmtMB(received)} / ${total ? fmtMB(total) : '?'} (${pct}%)`)
            lastLog = now
          }
        })
        res.pipe(file)
        file.on('finish', () => {
          file.close(() => {
            fs.renameSync(tmp, dest)
            process.stdout.write(`\r  ✓ saved ${meta.file} (${fmtMB(received)})\n`)
            resolve()
          })
        })
      }).on('error', (err) => {
        fs.rmSync(tmp, { force: true })
        reject(err)
      })
    }

    fetchUrl(url)
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const envList = (process.env.WHISPER_MODELS || '').split(/[,\s]+/).filter(Boolean)
  const requested = argv.length > 0 ? argv : (envList.length > 0 ? envList : ['medium'])

  console.log(`Models dir: ${MODELS_DIR}`)
  console.log(`Requested: ${requested.join(', ')}`)
  for (const name of requested) {
    await downloadOne(name)
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
