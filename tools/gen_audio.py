# -*- coding: utf-8 -*-
"""
为词库中的每个单词生成英文发音音频（edge-tts，en-US 女声）

用法：
    python tools/gen_audio.py            # 只生成缺失的音频
    python tools/gen_audio.py --force    # 全部重新生成

生成后自动回写 words.json / words.js 的 audio 字段。
"""
import asyncio
import json
import os
import re
import sys

try:
    import edge_tts
except ImportError:
    print("缺少依赖，请先执行：pip install edge-tts")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(ROOT, "audio")
WORDS_JSON = os.path.join(ROOT, "words.json")
WORDS_JS = os.path.join(ROOT, "words.js")

VOICE = os.environ.get("D5_VOICE", "en-US-AriaNeural")
RATE = os.environ.get("D5_RATE", "-8%")


def slug(word):
    s = re.sub(r"[^a-z0-9]+", "-", word.lower()).strip("-")
    return s or "word"


def silent_wav(path):
    """生成 0.1 秒静音 wav，用于移动端首次点击解锁音频播放"""
    import wave
    import struct
    rate, frames = 8000, 800
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<" + "h" * frames, *([0] * frames)))
    print("saved", path)


async def synth(text, out):
    comm = edge_tts.Communicate(text, VOICE, rate=RATE)
    await comm.save(out)


def main():
    force = "--force" in sys.argv
    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(os.path.join(AUDIO_DIR, "ex"), exist_ok=True)

    with open(WORDS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    made = 0

    def need_word_audio(w):
        nonlocal made
        name = slug(w["word"]) + ".mp3"
        rel = "audio/" + name
        path = os.path.join(ROOT, rel)
        if os.path.exists(path) and not force:
            w["audio"] = rel
            return
        try:
            asyncio.run(synth(w["word"], path))
            w["audio"] = rel
            made += 1
            print("  +", w["word"], "->", rel)
        except Exception as e:
            print("  ! 失败", w["word"], e)
            w["audio"] = w.get("audio", "")

    def need_example_audio(w):
        """为每条例句生成整句发音：audio/ex/<slug>-<n>.mp3"""
        nonlocal made
        s = slug(w["word"])
        for i, ex in enumerate(w.get("examples") or []):
            rel = "audio/ex/%s-%d.mp3" % (s, i + 1)
            path = os.path.join(ROOT, rel)
            if os.path.exists(path) and not force:
                ex["audio"] = rel
                continue
            text = re.sub(r"\*\*", "", ex.get("en") or "").strip()
            if not text:
                continue
            try:
                asyncio.run(synth(text, path))
                ex["audio"] = rel
                made += 1
                print("  + 例句", w["word"], i + 1, "->", rel)
            except Exception as e:
                print("  ! 例句失败", w["word"], i + 1, e)

    for w in data["words"]:
        need_word_audio(w)
        need_example_audio(w)

    with open(WORDS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    with open(WORDS_JS, "w", encoding="utf-8") as f:
        f.write("window.__WORDS__ = ")
        json.dump(data, f, ensure_ascii=False)
        f.write(";\n")

    silent_wav(os.path.join(AUDIO_DIR, "silence.wav"))
    print("done, generated %d audio files" % made)


if __name__ == "__main__":
    main()
