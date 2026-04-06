import { useEffect, useRef, useCallback } from 'react'

type WSMessage =
  | { type: 'transcription'; text: string }
  | { type: 'status'; text: string }
  | { type: 'pong' }

type Handlers = {
  onTranscription?: (text: string) => void
  onStatus?: (text: string) => void
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
        } else if (msg.type === 'status') {
          handlersRef.current.onStatus?.(msg.text)
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

  useEffect(() => {
    const timer = setTimeout(connect, 500)
    return () => {
      clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [connect])
}
