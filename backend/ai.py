from google import genai
from google.genai import types

MODELS_TO_TRY = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-flash-latest",
]


def get_ai_suggestion(
    user_question: str,
    system_prompt: str,
    api_key: str,
    conversation_history: list[tuple[str, str]] | None = None,
) -> str:
    try:
        client = genai.Client(api_key=api_key)

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
