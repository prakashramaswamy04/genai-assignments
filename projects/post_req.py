import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

completion = client.chat.completions.create(
    model="openai/gpt-oss-120b",
    messages=[
        {
            "role": "user",
            "content": "Explain Selenium Library in 3 lines."
        }
    ],
    temperature=1,
    max_completion_tokens=500,
    reasoning_effort="medium",
    stream=True
)

for chunk in completion:
    print(chunk.choices[0].delta.content or "", end="")