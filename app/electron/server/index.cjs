const express = require('express')
const cors = require('cors')
const http = require('http')
const { WebSocketServer } = require('ws')
const { execSync } = require('child_process')

const ws = require('./ws.cjs')
const sessionStore = require('./lib/sessionStore.cjs')
const conversationHistory = require('./lib/conversationHistory.cjs')
const heartbeat = require('./lib/heartbeat.cjs')
const listenManager = require('./lib/listenManager.cjs')
const wsCommands = require('./lib/wsCommands.cjs')
const { loadConfig } = require('./lib/config.cjs')

const healthRoute = require('./routes/health.cjs')
const configRoute = require('./routes/config.cjs')
const authRoute = require('./routes/auth.cjs')
const sessionRoute = require('./routes/session.cjs')
const jobsRoute = require('./routes/jobs.cjs')
const devicesRoute = require('./routes/devices.cjs')
const listenRoute = require('./routes/listen.cjs')
const recordRoute = require('./routes/record.cjs')
const suggestRoute = require('./routes/suggest.cjs')

const PORT = 7432
const HOST = '127.0.0.1'

let httpServer = null
let wsServer = null
let runtimeOptions = null

function killPortHolders() {
  try {
    execSync(`lsof -ti :${PORT} | xargs kill -9`, { stdio: 'ignore' })
  } catch {}
}

function buildApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '4mb' }))

  app.use(healthRoute)
  app.use(configRoute)
  app.use(authRoute)
  app.use(sessionRoute)
  app.use(jobsRoute)
  app.use(devicesRoute)
  app.use(listenRoute)
  app.use(recordRoute)
  app.use(suggestRoute)

  app.use((err, _req, res, _next) => {
    console.error('[server] error:', err)
    res.status(500).json({ error: 'internal_error', detail: String(err?.message || err) })
  })

  return app
}

function attachWebSocket(server) {
  wsServer = new WebSocketServer({ server, path: '/ws' })
  wsServer.on('connection', (socket) => {
    ws.register(socket)
    socket.send(JSON.stringify({ type: 'status', text: 'connected' }))
    socket.on('message', (raw) => {
      try { wsCommands.handleMessage(socket, raw.toString()) } catch (err) {
        console.error('[ws] message error:', err)
      }
    })
  })
}

function startBackendServer(options = {}) {
  return new Promise((resolve, reject) => {
    runtimeOptions = {
      apiBase: options.apiBase || loadConfig().api_base,
      onReady: typeof options.onReady === 'function' ? options.onReady : () => {},
      onError: typeof options.onError === 'function' ? options.onError : () => {},
    }

    killPortHolders()

    const app = buildApp()
    httpServer = http.createServer(app)
    attachWebSocket(httpServer)

    httpServer.once('error', (err) => {
      console.error('[server] listen error:', err)
      reject(err)
      runtimeOptions.onError(err)
    })

    httpServer.listen(PORT, HOST, () => {
      console.log(`[server] listening on http://${HOST}:${PORT}`)
      runtimeOptions.onReady()
      resolve({ port: PORT, host: HOST })
    })
  })
}

function stopBackendServer() {
  return new Promise((resolve) => {
    listenManager.stop()
    heartbeat.stop()
    sessionStore.clear()
    conversationHistory.clear()
    ws.closeAll()
    if (wsServer) {
      try { wsServer.close() } catch {}
      wsServer = null
    }
    if (httpServer) {
      httpServer.close(() => {
        httpServer = null
        resolve()
      })
      setTimeout(() => {
        if (httpServer) {
          try { httpServer.unref() } catch {}
          httpServer = null
        }
        resolve()
      }, 1500).unref()
    } else {
      resolve()
    }
  })
}

function getRuntimeOptions() {
  return runtimeOptions
}

module.exports = {
  startBackendServer,
  stopBackendServer,
  getRuntimeOptions,
  PORT,
  HOST,
}
