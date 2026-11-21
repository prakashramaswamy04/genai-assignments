import os
from dotenv import load_dotenv
from groq import Groq


def generate_response(prompt: str) -> str:
    load_dotenv()

    client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    raw_response = client.chat.completions.with_raw_response.create(
        model="qwen/qwen3.8-27b",
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        temperature=0.3,
        max_completion_tokens=100,
        # top_p=1,
        # reasoning_effort="medium",
        stream=True,
        extra_body={"stream_options": {"include_usage": True}}
    )
    print(f"HTTP Status: {raw_response.status_code}")

    completion = raw_response.parse()
    response_parts = []

    for chunk in completion:
        if chunk.choices:
            content = chunk.choices[0].delta.content or ""
            reasoning = chunk.choices[0].delta.reasoning or ""
            response_parts.append(content)
            response_parts.append(reasoning)
            print(content, end="")

        if chunk.x_groq and chunk.x_groq.usage:
            usage = chunk.x_groq.usage

            print("\n\n========== TOKEN USAGE ==========")
            print(f"Prompt tokens:     {usage.prompt_tokens}")
            print(f"Completion tokens: {usage.completion_tokens}")
            print(f"Total tokens:      {usage.total_tokens}")

    return "".join(response_parts)


if __name__ == "__main__":
    generate_response("Weather in Chennai now")