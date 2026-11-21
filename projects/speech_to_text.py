import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq


AUDIO_FILE = Path(__file__).resolve().with_name("Meeting Recording.mp3")


def transcribe_audio(audio_path: Path = AUDIO_FILE) -> str:
    load_dotenv(dotenv_path=Path(__file__).resolve().with_name(".env"))
    client = Groq(api_key=os.getenv("GROQ_API_KEY"))

    with audio_path.open("rb") as audio_file:
        transcription = client.audio.transcriptions.create(
            file=(audio_path.name, audio_file.read()),
            model="whisper-large-v3",
            temperature=0,
            response_format="verbose_json",
        )

    return transcription.text


if __name__ == "__main__":
    print(transcribe_audio())
