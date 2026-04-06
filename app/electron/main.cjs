const { app, BrowserWindow, ipcMain, shell, systemPreferences } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const VENV_DIR = path.join(os.homedir(), '.interview_assistant', 'venv')
const SETUP_MARKER = path.join(os.homedir(), '.interview_assistant', '.setup_done')

let mainWindow = null
let pythonProcess = null

// ── Python paths ────────────────────────────────────────────────────────────

function getBackendDir() {
  if (isDev) return path.join(__dirname, '../../backend')
  return path.join(process.resourcesPath, 'backend')
}

function getPythonExecutable() {
  // 1. Persistent user venv (after first-run setup)
  const venvPython = path.join(VENV_DIR, 'bin', 'python3')
  if (fs.existsSync(venvPython)) return venvPython

  // 2. Dev project venv
  if (isDev) {
    const devVenv = path.join(__dirname, '../../.venv/bin/python3')
    if (fs.existsSync(devVenv)) return devVenv
  }

  // 3. Homebrew Python 3.11
  const candidates = [
    '/opt/homebrew/bin/python3.11',
    '/opt/homebrew/opt/python@3.11/bin/python3.11',
    '/usr/local/bin/python3.11',
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return 'python3'
}

function needsSetup() {
  return !fs.existsSync(SETUP_MARKER)
}

// ── First-run setup ─────────────────────────────────────────────────────────

function runSetup() {
  return new Promise((resolve) => {
    const backendDir = getBackendDir()
    const setupScript = path.join(backendDir, 'setup_env.py')

    // Find any available python3 to bootstrap
    const bootstrapCandidates = [
      '/opt/homebrew/bin/python3.11',
      '/opt/homebrew/opt/python@3.11/bin/python3.11',
      '/usr/local/bin/python3.11',
      '/usr/bin/python3',
    ]
    let bootstrapPy = 'python3'
    for (const p of bootstrapCandidates) {
      if (fs.existsSync(p)) { bootstrapPy = p; break }
    }

    const proc = spawn(bootstrapPy, [setupScript], {
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:${process.env.PATH}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (mainWindow) mainWindow.webContents.send('setup-progress', obj.status)
        } catch { /* ignore non-JSON lines */ }
      }
    })

    proc.on('exit', (code) => {
      resolve(code === 0)
    })
  })
}

// ── Python server ────────────────────────────────────────────────────────────

function startPythonServer() {
  try { require('child_process').execSync('lsof -ti :7432 | xargs kill -9', { stdio: 'ignore' }) } catch {}
  const python = getPythonExecutable()
  const backendDir = getBackendDir()
  const serverScript = path.join(backendDir, 'server.py')

  console.log(`Starting Python: ${python} ${serverScript}`)

  pythonProcess = spawn(python, [serverScript], {
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONPATH: backendDir,
      WHISPER_SKIP_CHECKSUM: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  pythonProcess.stdout.on('data', (d) => console.log(`[py] ${d.toString().trim()}`))
  pythonProcess.stderr.on('data', (d) => {
    const msg = d.toString().trim()
    if (msg && !msg.includes('INFO:') && !msg.includes('FutureWarning') && !msg.includes('DeprecationWarning')) {
      console.error(`[py!] ${msg}`)
    }
  })
  pythonProcess.on('exit', (code) => {
    console.log(`Python exited: ${code}`)
    pythonProcess = null
  })
}

function stopPythonServer() {
  if (pythonProcess) {
    try {
      process.kill(-pythonProcess.pid, 'SIGKILL')
    } catch {
      pythonProcess.kill('SIGKILL')
    }
    pythonProcess = null
  }
}

async function waitForBackend(maxMs = 30000) {
  const http = require('http')
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:7432/health', (res) => resolve(res.statusCode === 200))
        req.on('error', reject)
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')) })
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 860,
    minWidth: 860,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
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

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

// ── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('set-always-on-top', (_e, v) => mainWindow?.setAlwaysOnTop(v))
ipcMain.handle('set-opacity', (_e, v) => mainWindow?.setOpacity(Math.min(1, Math.max(0.1, v))))
ipcMain.handle('get-opacity', () => mainWindow?.getOpacity() ?? 1)
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url))
ipcMain.handle('needs-setup', () => needsSetup())
ipcMain.handle('run-setup', async () => {
  const ok = await runSetup()
  return ok
})

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

    // Step 1: brew fetch (no sudo needed) to download the .pkg
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

    // Step 2: find the downloaded .pkg in brew's cache
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

    // Step 3: install .pkg via osascript (macOS shows password dialog, runs as root)
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

app.whenReady().then(async () => {
  createWindow()

  // First-run setup if needed
  if (needsSetup()) {
    if (mainWindow) mainWindow.webContents.send('setup-progress', 'SETUP_REQUIRED')
    const ok = await runSetup()
    if (!ok) {
      if (mainWindow) mainWindow.webContents.send('backend-ready', false)
      return
    }
  }

  startPythonServer()
  const ready = await waitForBackend()
  if (mainWindow) mainWindow.webContents.send('backend-ready', ready)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopPythonServer()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopPythonServer())
