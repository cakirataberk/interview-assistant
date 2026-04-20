const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const http = require('http')
const https = require('https')

const { startBackendServer, stopBackendServer } = require('./server/index.cjs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const API_BASE = process.env.BASVUR_API_BASE || 'https://basvur-ai.vercel.app'
const DEEP_LINK_SCHEME = 'basvurai'

let mainWindow = null
let pendingLinkState = null
let pendingDeepLink = null

// ── Single-instance + deep link registration ────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
}

// ── Deep link auth flow ─────────────────────────────────────────────────────

function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const data = JSON.stringify(body)
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(opts, (res) => {
      let chunks = ''
      res.on('data', (c) => { chunks += c })
      res.on('end', () => {
        try {
          const parsed = chunks ? JSON.parse(chunks) : {}
          resolve({ status: res.statusCode || 0, body: parsed })
        } catch {
          resolve({ status: res.statusCode || 0, body: { raw: chunks } })
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(data)
    req.end()
  })
}

function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function handleDeepLink(urlStr) {
  if (!urlStr || !urlStr.startsWith(`${DEEP_LINK_SCHEME}://`)) return
  let parsed
  try {
    parsed = new URL(urlStr)
  } catch {
    return
  }
  if (parsed.hostname !== 'auth') return

  const code = parsed.searchParams.get('code')
  const state = parsed.searchParams.get('state')
  if (!code) {
    notifyRenderer('link-error', { message: 'missing code' })
    return
  }
  if (pendingLinkState && state !== pendingLinkState) {
    notifyRenderer('link-error', { message: 'state mismatch' })
    return
  }

  notifyRenderer('link-progress', 'exchanging')

  try {
    const label = `${os.hostname()} — ${os.userInfo().username}`
    const exchange = await postJson(`${API_BASE}/api/device/exchange`, {
      code,
      state,
      label,
    })
    if (exchange.status !== 200 || !exchange.body?.deviceToken) {
      notifyRenderer('link-error', {
        message: exchange.body?.error || `exchange failed (${exchange.status})`,
      })
      return
    }
    const deviceToken = exchange.body.deviceToken

    const tokenWrite = await postJson('http://127.0.0.1:7432/auth/token', {
      device_token: deviceToken,
      api_base: API_BASE,
    })
    if (tokenWrite.status !== 200) {
      notifyRenderer('link-error', { message: 'backend token write failed' })
      return
    }

    pendingLinkState = null
    notifyRenderer('link-done', { ok: true })
  } catch (err) {
    notifyRenderer('link-error', { message: String(err?.message || err) })
  }
}

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (pendingDeepLink) {
      const url = pendingDeepLink
      pendingDeepLink = null
      handleDeepLink(url)
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

// ── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('set-always-on-top', (_e, v) => mainWindow?.setAlwaysOnTop(v))
ipcMain.handle('set-opacity', (_e, v) => mainWindow?.setOpacity(Math.min(1, Math.max(0.1, v))))
ipcMain.handle('get-opacity', () => mainWindow?.getOpacity() ?? 1)
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url))

ipcMain.handle('start-link-flow', async (_e, locale = 'tr') => {
  const state = crypto.randomBytes(16).toString('hex')
  pendingLinkState = state
  const url = `${API_BASE}/${locale}/interview-copilot/link?state=${encodeURIComponent(state)}`
  await shell.openExternal(url)
  return { ok: true, state }
})

ipcMain.handle('get-api-base', () => API_BASE)

// ── BlackHole ─────────────────────────────────────────────────────────────────

function isBlackHoleInstalled() {
  return fs.existsSync('/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver')
}

ipcMain.handle('blackhole-check', () => isBlackHoleInstalled())

ipcMain.handle('blackhole-install', () => {
  return new Promise((resolve) => {
    const send = (status, detail = '') => {
      mainWindow?.webContents.send('blackhole-progress', { status, detail })
    }

    const { execSync } = require('child_process')

    send('progress', 'Downloading BlackHole 2ch...')
    try {
      execSync('/opt/homebrew/bin/brew fetch --cask blackhole-2ch', {
        env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`, HOME: os.homedir() },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      send('error', 'Download failed: ' + e.message)
      return resolve({ ok: false })
    }

    let pkgPath = ''
    try {
      pkgPath = execSync('/opt/homebrew/bin/brew --cache --cask blackhole-2ch', {
        env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`, HOME: os.homedir() },
        encoding: 'utf8',
      }).trim()
    } catch {}

    if (!pkgPath) {
      send('error', 'Could not find downloaded package')
      return resolve({ ok: false })
    }

    send('progress', 'Requesting administrator privileges...')

    const script = `do shell script "/usr/sbin/installer -pkg \\"${pkgPath}\\" -target /" with administrator privileges`
    const proc = spawn('osascript', ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    proc.stdout.on('data', (d) => send('progress', d.toString().trim()))
    proc.stderr.on('data', (d) => send('progress', d.toString().trim()))
    proc.on('exit', (code) => {
      if (code === 0) {
        send('done')
        resolve({ ok: true })
      } else {
        send('error', `Installation failed (code ${code})`)
        resolve({ ok: false })
      }
    })
  })
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (mainWindow) {
    handleDeepLink(url)
  } else {
    pendingDeepLink = url
  }
})

app.on('second-instance', (_e, argv) => {
  const linkArg = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`))
  if (linkArg) {
    if (mainWindow) handleDeepLink(linkArg)
    else pendingDeepLink = linkArg
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  createWindow()

  try {
    await startBackendServer({
      apiBase: API_BASE,
      onReady: () => notifyRenderer('backend-ready', true),
      onError: (err) => {
        console.error('[main] backend error:', err)
        notifyRenderer('backend-ready', false)
      },
    })
  } catch (err) {
    console.error('[main] failed to start backend:', err)
    notifyRenderer('backend-ready', false)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await stopBackendServer()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (event) => {
  if (stopBackendServer.called) return
  event.preventDefault()
  stopBackendServer.called = true
  try {
    await stopBackendServer()
  } finally {
    app.quit()
  }
})
