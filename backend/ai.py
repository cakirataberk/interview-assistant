from typing import AsyncGenerator

from google import genai
from google.genai import types

MODELS_TO_TRY = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]

_client_cache: dict[str, genai.Client] = {}


def _get_client(api_key: str) -> genai.Client:
    if api_key not in _client_cache:
        _client_cache[api_key] = genai.Client(api_key=api_key)
    return _client_cache[api_key]


async def async_stream_ai_suggestion(
    user_question: str,
    system_prompt: str,
    api_key: str,
    conversation_history: list[tuple[str, str]] | None = None,
) -> AsyncGenerator[str, None]:
    """Async generator that yields text chunks from Gemini streaming API."""
    try:
        client = _get_client(api_key)

        if conversation_history:
            history_text = "\n\n--- Previous Conversation ---\n"
            for i, (q_text, a_text) in enumerate(conversation_history[-5:], 1):
                history_text += f"\nQ{i}: {q_text}\nA{i}: {a_text}\n"
            history_text += "\n--- Current Question ---\n"
            full_question = history_text + user_question
        else:
            full_question = user_question

        last_err = None
        for model_name in MODELS_TO_TRY:
            try:
                async for chunk in await client.aio.models.generate_content_stream(
                    model=model_name,
                    contents=full_question,
                    config=types.GenerateContentConfig(system_instruction=system_prompt),
                ):
                    if chunk.text:
                        yield chunk.text
                return
            except Exception as e:
                print(f"[AI] {model_name} failed: {e}", flush=True)
                last_err = e
                continue

        yield f"AI error: {last_err}"
    except Exception as err:
        yield f"AI error: {err}"


def stream_ai_suggestion(
    user_question: str,
    system_prompt: str,
    api_key: str,
    conversation_history: list[tuple[str, str]] | None = None,
):
    """Yields text chunks as Gemini streams them."""
    try:
        client = _get_client(api_key)

        if conversation_history:
            history_text = "\n\n--- Previous Conversation ---\n"
            for i, (q_text, a_text) in enumerate(conversation_history[-5:], 1):
                history_text += f"\nQ{i}: {q_text}\nA{i}: {a_text}\n"
            history_text += "\n--- Current Question ---\n"
            full_question = history_text + user_question
        else:
            full_question = user_question

        last_err = None
        for model_name in MODELS_TO_TRY:
            try:
                for chunk in client.models.generate_content_stream(
                    model=model_name,
                    contents=full_question,
                    config=types.GenerateContentConfig(system_instruction=system_prompt),
                ):
                    if chunk.text:
                        yield chunk.text
                return
            except Exception as e:
                print(f"[AI] {model_name} failed: {e}", flush=True)
                last_err = e
                continue

        yield f"AI error: {last_err}"
    except Exception as err:
        yield f"AI error: {err}"


def get_ai_suggestion(
    user_question: str,
    system_prompt: str,
    api_key: str,
    conversation_history: list[tuple[str, str]] | None = None,
) -> str:
    try:
        client = _get_client(api_key)

        if conversation_history:
            history_text = "\n\n--- Previous Conversation ---\n"
            for i, (q_text, a_text) in enumerate(conversation_history[-5:], 1):
                history_text += f"\nQ{i}: {q_text}\nA{i}: {a_text}\n"
            history_text += "\n--- Current Question ---\n"
            full_question = history_text + user_question
        else:
            full_question = user_question

        last_err = None
        for model_name in MODELS_TO_TRY:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=full_question,
                    config=types.GenerateContentConfig(system_instruction=system_prompt),
                )
                print(f"[AI] Used model: {model_name}", flush=True)
                return response.text
            except Exception as e:
                print(f"[AI] {model_name} failed: {e}", flush=True)
                last_err = e
                continue

        return f"AI error: {last_err}"
    except Exception as err:
        return f"AI error: {err}"
