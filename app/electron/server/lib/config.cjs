const fs = require('fs')
const path = require('path')
const os = require('os')

const CONFIG_DIR = path.join(os.homedir(), '.interview_assistant')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULT_API_BASE = 'https://basvur-ai.vercel.app'

const DEFAULT_CONFIG = {
  window_alpha: 0.96,
  microphone_device_index: 0,
  transcription_mode: 'TR + ENG (Mixed)',
  device_token: '',
  api_base: DEFAULT_API_BASE,
  locale: 'tr',
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
      const saved = JSON.parse(raw)
      return { ...DEFAULT_CONFIG, ...saved }
    }
  } catch (err) {
    console.error('[config] load error:', err.message)
  }
  return { ...DEFAULT_CONFIG }
}

function saveConfig(partial) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const current = loadConfig()
  const next = { ...current, ...partial }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

function clearToken() {
  saveConfig({ device_token: '' })
}

module.exports = {
  loadConfig,
  saveConfig,
  clearToken,
  DEFAULT_API_BASE,
  CONFIG_DIR,
  CONFIG_FILE,
}
