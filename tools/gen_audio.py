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
import time

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

# ---- 离线兜底：Windows SAPI 语音（edge-tts 被封/限流时使用）----
SAPI_VOICE = os.environ.get(
    "D5_SAPI_VOICE",
    r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0",
)
SAPI_RATE = int(os.environ.get("D5_SAPI_RATE", "184"))  # 默认 200，-8% ≈ 184
_sapi_engine = None


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
    """合成到临时文件，成功且非空后再原子替换成正式文件。

    这样即使中途超时/中断，也不会在磁盘留下残缺 mp3
    （残缺文件会被 os.path.exists 判断当成"已生成"而永久跳过）。
    """
    tmp = out + ".part"
    comm = edge_tts.Communicate(text, VOICE, rate=RATE)
    await asyncio.wait_for(comm.save(tmp), timeout=40)
    if not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
        raise RuntimeError("empty output file")
    os.replace(tmp, out)


def _sapi_render(text, out):
    """真正做合成的一段：windows SAPI -> wav -> lameenc 编码 mp3。

    ⚠️ 必须在独立子进程里跑：pyttsx3 复用同一个 engine 多次调用
    save_to_file + runAndWait 时会在第二次起永久挂死（无报错、无输出）。
    因此每条音频都新起一个 python 进程，并用 timeout 兜底。
    """
    import wave

    import lameenc
    import pyttsx3

    tmp_wav = out + ".sapi.wav"
    tmp = out + ".part"
    for p in (tmp_wav, tmp):
        if os.path.exists(p):
            os.remove(p)

    eng = pyttsx3.init()
    try:
        eng.setProperty("voice", SAPI_VOICE)
    except Exception:
        pass                      # 语音不存在就用系统默认
    eng.setProperty("rate", SAPI_RATE)
    eng.save_to_file(text, tmp_wav)
    eng.runAndWait()
    try:
        eng.stop()
    except Exception:
        pass
    if not os.path.exists(tmp_wav) or os.path.getsize(tmp_wav) == 0:
        raise RuntimeError("sapi produced no audio")

    with wave.open(tmp_wav, "rb") as w:
        nch, sw, fr = w.getnchannels(), w.getsampwidth(), w.getframerate()
        pcm = w.readframes(w.getnframes())
    if sw != 2:
        raise RuntimeError("unsupported sample width %d" % sw)

    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(fr)
    enc.set_channels(nch)
    enc.set_quality(2)
    with open(tmp, "wb") as f:
        f.write(enc.encode(pcm) + enc.flush())
    if os.path.getsize(tmp) == 0:
        raise RuntimeError("mp3 encode produced empty file")
    os.replace(tmp, out)
    os.remove(tmp_wav)


def sapi_synth(text, out, timeout=90):
    """在独立子进程里跑 SAPI 合成，避免 pyttsx3 复用 engine 挂死。"""
    import subprocess

    r = subprocess.run(
        [sys.executable, os.path.abspath(__file__), "--sapi-worker", text, out],
        timeout=timeout,
        capture_output=True,
    )
    if r.returncode != 0:
        raise RuntimeError(
            "sapi worker failed: %s" % (r.stderr.decode("utf-8", "ignore")[-200:] or r.returncode)
        )
    if not os.path.exists(out) or os.path.getsize(out) == 0:
        raise RuntimeError("sapi produced empty file")


def _cleanup(path):
    for p in (path, path + ".part", path + ".sapi.wav"):
        if os.path.exists(p):
            try:
                os.remove(p)      # 清掉 0 字节/残缺残留，避免下次被跳过
            except OSError:
                pass


def synth_retry(text, path, tries=3):
    """合成到 path：edge-tts 优先，失败则退避重试，仍失败转离线 SAPI 兜底。

    - edge-tts 偶发 wss 超时 -> 每次带 40s 超时并退避重试；
    - edge-tts 返回 403（微软按 IP 封禁/限流）-> 不再重试，直接走 SAPI；
    - SAPI 也失败 -> 删除残留后抛出，交给上层记录"失败"。
    """
    last = None
    for i in range(tries):
        try:
            asyncio.run(synth(text, path))
            if os.path.exists(path) and os.path.getsize(path) > 0:
                return True
            last = RuntimeError("empty output file")
        except Exception as e:
            last = e
        _cleanup(path)
        # 403 说明服务端已拒绝该出口 IP，重试没有意义，直接转离线兜底
        if "403" in str(last):
            break
        if i < tries - 1:
            time.sleep(3 + 2 * i)

    try:
        sapi_synth(text, path)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print("    (离线 SAPI 兜底)", end=" ")
            return True
        last = RuntimeError("sapi produced empty file")
    except Exception as e:
        last = e
    _cleanup(path)
    raise last


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
            synth_retry(w["word"], path)
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
                synth_retry(text, path)
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
    if len(sys.argv) >= 4 and sys.argv[1] == "--sapi-worker":
        _sapi_render(sys.argv[2], sys.argv[3])   # 子进程模式：只合成这一条
    else:
        main()
