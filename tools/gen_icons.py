# -*- coding: utf-8 -*-
"""生成 PWA 图标：蓝渐变底 + 白色「5」+ 每日五词"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def gradient(size):
    """左上 #2563eb → 右下 #38bdf8 渐变"""
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    c1, c2 = (37, 99, 235), (56, 189, 248)
    for y in range(size):
        for_x = y / max(1, size - 1)
        r = int(c1[0] + (c2[0] - c1[0]) * for_x)
        g = int(c1[1] + (c2[1] - c1[1]) * for_x)
        b = int(c1[2] + (c2[2] - c1[2]) * for_x)
        d.line([(0, y), (size, y)], fill=(r, g, b))
    return img


def make(size, name):
    img = gradient(size)
    d = ImageDraw.Draw(img)

    # 白色圆角底衬
    pad = int(size * 0.13)
    d.rounded_rectangle([pad, pad, size - pad, size - pad],
                        radius=int(size * 0.18), fill=(255, 255, 255, 255))

    f5 = font(int(size * 0.42))
    txt = "5"
    bb = d.textbbox((0, 0), txt, font=f5)
    d.text(((size - (bb[2] - bb[0])) / 2 - bb[0], size * 0.30 - bb[1]),
           txt, font=f5, fill=(37, 99, 235))

    fs = font(int(size * 0.115))
    sub = "每日五词"
    bb2 = d.textbbox((0, 0), sub, font=fs)
    d.text(((size - (bb2[2] - bb2[0])) / 2 - bb2[0], size * 0.68 - bb2[1]),
           sub, font=fs, fill=(37, 99, 235))

    path = os.path.join(OUT, name)
    img.save(path, "PNG", optimize=True)
    print("saved", path, img.size)


if __name__ == "__main__":
    make(192, "icon-192.png")
    make(512, "icon-512.png")
    make(180, "apple-touch-icon.png")
    make(32, "favicon-32.png")
