const MAX_PAIRS = 5

const history = []

function append(question, answer) {
  history.push({ q: question, a: answer })
  while (history.length > MAX_PAIRS) history.shift()
}

function list() {
  return history.slice()
}

function count() {
  return history.length
}

function clear() {
  history.length = 0
}

module.exports = { append, list, count, clear, MAX_PAIRS }
