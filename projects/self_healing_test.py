
import os
import base64
from pathlib import Path
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(
    api_key=os.getenv("GROQ_API_KEY_PNG")
)

# Convert screenshot to Base64
image_path = Path(__file__).resolve().with_name(
    "Session Expired Modal over Create Lead Form.png"
)
with image_path.open("rb") as image:
    image_data = base64.b64encode(image.read()).decode("utf-8")

# Sample DOM
dom = """
<div role="dialog"
     aria-modal="true"
     aria-labelledby="popupTitle"
     id="sessionPopup">

    <button type="button"
            id="closePopup"
            aria-label="Close">×</button>

    <h2 id="popupTitle">Session Expired</h2>

    <p>Your session has expired. Please log in again.</p>

    <button type="button" id="okButton">OK</button>
</div>
"""

try:
    completion = client.chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"""
                        Analyze the attached screenshot.

                    Identify the Session Expired popup.
                    Locate its Close (X) button in the top-right corner.

                        Return the XPath you would use to locate this button.

                        Return only the XPath. No explanation.
                        """
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_data}"
                        }
                    }
                ]
            }
        ],
        temperature=0.2,
        max_completion_tokens=2048,
        top_p=0.95,
        stream=True,
        extra_body={
            "stream_options": {
                "include_usage": True
            }
        }
    )

    for chunk in completion:

        if chunk.choices:
            print(
                chunk.choices[0].delta.content or "",
                end=""
            )

        if chunk.x_groq and chunk.x_groq.usage:
            usage = chunk.x_groq.usage

            print("\n\n========== TOKEN USAGE ==========")
            print(f"Prompt tokens:     {usage.prompt_tokens}")
            print(f"Completion tokens: {usage.completion_tokens}")
            print(f"Total tokens:      {usage.total_tokens}")

except Exception as e:
    print(f"API Error: {e}")
