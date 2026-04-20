let active = null

function set(session) {
  active = { ...session }
}

function get() {
  return active
}

function clear() {
  active = null
}

function isActive() {
  return active !== null
}

function snapshot() {
  if (!active) return null
  const { sessionJwt: _, ...rest } = active
  return { ...rest, hasJwt: Boolean(active.sessionJwt) }
}

function getJwt() {
  return active?.sessionJwt || null
}

function getLocale() {
  return active?.locale || 'tr'
}

function updateSecondsRemaining(seconds) {
  if (active) active.secondsRemaining = seconds
}

module.exports = {
  set,
  get,
  clear,
  isActive,
  snapshot,
  getJwt,
  getLocale,
  updateSecondsRemaining,
}
