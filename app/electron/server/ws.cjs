const clients = new Set()

function register(ws) {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  ws.on('error', () => clients.delete(ws))
}

function broadcast(payload) {
  const msg = JSON.stringify(payload)
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try { ws.send(msg) } catch {}
    }
  }
}

function clientCount() {
  return clients.size
}

function closeAll() {
  for (const ws of clients) {
    try { ws.close() } catch {}
  }
  clients.clear()
}

module.exports = { register, broadcast, clientCount, closeAll }
