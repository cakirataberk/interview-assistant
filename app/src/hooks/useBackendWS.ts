import { useEffect, useRef, useCallback } from 'react'

type WSMessage =
  | { type: 'transcription'; text: string }
  | { type: 'partial'; text: string }
  | { type: 'status'; text: string }
  | { type: 'suggestion_chunk'; text: string }
  | { type: 'suggestion_done'; history_count: number }
  | { type: 'suggestion_error'; text: string }
  | { type: 'quota'; secondsRemaining: number; shouldStop: boolean }
  | { type: 'session_expired'; reason?: string }
  | { type: 'pong' }

type Handlers = {
  onTranscription?: (text: string) => void
  onPartial?: (text: string) => void
  onStatus?: (text: string) => void
  onSuggestionChunk?: (text: string) => void
  onSuggestionDone?: (historyCount: number) => void
  onSuggestionError?: (text: string) => void
  onQuota?: (secondsRemaining: number, shouldStop: boolean) => void
  onSessionExpired?: (reason?: string) => void
}

export function useBackendWS(handlers: Handlers) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket('ws://127.0.0.1:7432/ws')
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data)
        const h = handlersRef.current
        if (msg.type === 'transcription') h.onTranscription?.(msg.text)
        else if (msg.type === 'partial') h.onPartial?.(msg.text)
        else if (msg.type === 'status') h.onStatus?.(msg.text)
        else if (msg.type === 'suggestion_chunk') h.onSuggestionChunk?.(msg.text)
        else if (msg.type === 'suggestion_done') h.onSuggestionDone?.(msg.history_count)
        else if (msg.type === 'suggestion_error') h.onSuggestionError?.(msg.text)
        else if (msg.type === 'quota') h.onQuota?.(msg.secondsRemaining, msg.shouldStop)
        else if (msg.type === 'session_expired') h.onSessionExpired?.(msg.reason)
      } catch {
        // ignore
      }
    }

    ws.onclose = () => {
      setTimeout(connect, 1000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  const sendSuggest = useCallback((question: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ cmd: 'suggest', question }))
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(connect, 500)
    return () => {
      clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [connect])

  return { sendSuggest }
}
