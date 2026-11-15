import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

try:
    raw_response = client.chat.completions.with_raw_response.create(
        model="openai/gpt-oss-120b",
        messages=[
            {
                "role": "user",
                "content": "Explain robot framework in 10 lines"
            }
        ],
        temperature=1,
        max_completion_tokens=1500,
        top_p=1,
        reasoning_effort="medium",
        stream=True,
        extra_body={"stream_options": {"include_usage": True}}
    )
    print(raw_response)
    print(f"HTTP Status: {raw_response.status_code}")

    completion = raw_response.parse()

    for chunk in completion:
        if chunk.choices:
            print(chunk.choices[0].delta.content or "", end="")

        if chunk.x_groq and chunk.x_groq.usage:
            usage = chunk.x_groq.usage

            print("\n\n========== TOKEN USAGE ==========")
            print(f"Prompt tokens:     {usage.prompt_tokens}")
            print(f"Completion tokens: {usage.completion_tokens}")
            print(f"Total tokens:      {usage.total_tokens}")

except Exception as e:
    print(f"API Error: {e}")