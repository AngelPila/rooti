"""Rooti's voice: Edge TTS (free) with Vinci's Ecuadorian voice, as an .ogg voice note."""
import asyncio
import hashlib
import re
import subprocess

from rooti_bot import config

VOICE = "es-EC-LuisNeural"
# Read aloud, a link or a markdown mark is noise: the text bubble keeps them.
NOISE = re.compile(r"https?://\S+|[*_`#>]+")


def speakable(text: str) -> str:
    text = NOISE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


async def synthesize(text: str) -> str:
    """The path of an .ogg voice note saying `text`; the same text is synthesized once."""
    import edge_tts

    text = speakable(text)
    out_dir = config.data_dir() / "voz"
    out_dir.mkdir(exist_ok=True)
    stem = hashlib.sha1(f"{VOICE}:{text}".encode()).hexdigest()[:16]
    ogg = out_dir / f"{stem}.ogg"
    if ogg.exists():
        return str(ogg)
    mp3 = out_dir / f"{stem}.mp3"
    await edge_tts.Communicate(text, VOICE).save(str(mp3))
    await asyncio.to_thread(subprocess.run, ["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3), "-c:a", "libopus",
                                             "-b:a", "32k", "-ac", "1", str(ogg)], check=True)
    mp3.unlink(missing_ok=True)
    return str(ogg)
