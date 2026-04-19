"""
AI proxy client — all Gemini calls are proxied through basvur.ai.
The desktop app never holds an AI key; only short-lived session JWTs.
"""
from __future__ import annotations

import json
from typing import AsyncGenerator

import httpx


class AIProxyError(Exception):
    """Raised when the basvur.ai proxy returns a fatal response."""

    def __init__(self, code: str, status: int = 0, detail: str = ""):
        super().__init__(f"{code} ({status}): {detail}")
        self.code = code
        self.status = status
        self.detail = detail


async def async_stream_ai_suggestion(
    question: str,
    session_jwt: str,
    api_base: str,
    conversation_history: list[tuple[str, str]] | None = None,
    locale: str = "tr",
) -> AsyncGenerator[str, None]:
    """Proxy streaming through basvur.ai /api/interview/suggest.

    Yields text chunks. Raises AIProxyError on auth/quota/server failure.
    """
    url = f"{api_base.rstrip('/')}/api/interview/suggest"
    payload = {
        "question": question,
        "history": [
            {"q": q, "a": a} for q, a in (conversation_history or [])
        ][-5:],
        "locale": locale,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream(
            "POST",
            url,
            headers={"Authorization": f"Bearer {session_jwt}"},
            json=payload,
        ) as resp:
            if resp.status_code == 401:
                raise AIProxyError("unauthorized", 401, "session expired")
            if resp.status_code == 403:
                raise AIProxyError("trial_expired", 403, "quota exhausted")
            if resp.status_code != 200:
                body = (await resp.aread()).decode(errors="replace")
                raise AIProxyError("proxy_error", resp.status_code, body[:200])

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw:
                    continue
                try:
                    evt = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if evt.get("error"):
                    raise AIProxyError(
                        str(evt.get("error")), 200, str(evt.get("detail", ""))
                    )
                if evt.get("done"):
                    return
                text = evt.get("text")
                if text:
                    yield text
