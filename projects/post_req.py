import os
from groq import Groq
from dotenv import load_dotenv


def generate_response(prompt: str) -> str:
    load_dotenv()

    client = Groq(
        api_key=os.getenv("GROQ_API_KEY")
    )
    raw_response = client.chat.completions.with_raw_response.create(
        model="openai/gpt-oss-120b",
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=1,
        max_completion_tokens=1500,
        top_p=1,
        reasoning_effort="medium",
        stream=True,
        extra_body={"stream_options": {"include_usage": True}}
    )
    print(f"HTTP Status: {raw_response.status_code}")

    completion = raw_response.parse()
    response_parts = []

    for chunk in completion:
        if chunk.choices:
            content = chunk.choices[0].delta.content or ""
            response_parts.append(content)
            print(content, end="")

        if chunk.x_groq and chunk.x_groq.usage:
            usage = chunk.x_groq.usage

            print("\n\n========== TOKEN USAGE ==========")
            print(f"Prompt tokens:     {usage.prompt_tokens}")
            print(f"Completion tokens: {usage.completion_tokens}")
            print(f"Total tokens:      {usage.total_tokens}")

    return "".join(response_parts)


if __name__ == "__main__":
    generate_response("Explain robot framework in 10 lines")