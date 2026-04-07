import { useEffect, useRef, useCallback } from 'react'

type WSMessage =
  | { type: 'transcription'; text: string }
  | { type: 'partial'; text: string }
  | { type: 'status'; text: string }
  | { type: 'suggestion_chunk'; text: string }
  | { type: 'suggestion_done'; history_count: number }
  | { type: 'suggestion_error'; text: string }
  | { type: 'pong' }

type Handlers = {
  onTranscription?: (text: string) => void
  onPartial?: (text: string) => void
  onStatus?: (text: string) => void
  onSuggestionChunk?: (text: string) => void
  onSuggestionDone?: (historyCount: number) => void
  onSuggestionError?: (text: string) => void
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
        if (msg.type === 'transcription') {
          handlersRef.current.onTranscription?.(msg.text)
        } else if (msg.type === 'partial') {
          handlersRef.current.onPartial?.(msg.text)
        } else if (msg.type === 'status') {
          handlersRef.current.onStatus?.(msg.text)
        } else if (msg.type === 'suggestion_chunk') {
          handlersRef.current.onSuggestionChunk?.(msg.text)
        } else if (msg.type === 'suggestion_done') {
          handlersRef.current.onSuggestionDone?.(msg.history_count)
        } else if (msg.type === 'suggestion_error') {
          handlersRef.current.onSuggestionError?.(msg.text)
        }
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

  const sendSuggest = useCallback((params: Record<string, unknown>) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ cmd: 'suggest', ...params }))
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
