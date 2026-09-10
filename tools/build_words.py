# -*- coding: utf-8 -*-
"""
解析 daily-english/ 目录下所有「每日五词」Markdown，生成 web/words.json

用法：
    python tools/build_words.py

设计原则：
- 容错解析：不同期次的 Markdown 版式不完全一致，缺失字段留空而不是报错
- 已存在的记录以 word 为键做合并（人工修正过的字段不会被覆盖）
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # web/
BASE = os.path.dirname(ROOT)                                                # daily-english/
OUT = os.path.join(ROOT, "words.json")
OVERRIDES = os.path.join(ROOT, "tools", "overrides.json")


def auto_gloss(meaning):
    """从长释义里截一个适合做选择题的短中文"""
    if not meaning:
        return ""
    s = re.sub(r"^(n|v|adj|adv|prep)\.\s*", "", meaning.strip())
    s = re.split(r"[；;。\n（(]", s)[0]
    s = s.strip(" 、,，")
    return s[:14]


def strip_md(s):
    """去掉 markdown 加粗/行内代码等标记"""
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"`(.+?)`", r"\1", s)
    return s.strip()


def parse_file(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()

    # 期次 / 日期
    m = re.search(r"第\s*(\d+)\s*期", text)
    issue = int(m.group(1)) if m else 0
    m = re.search(r"(20\d{2}-\d{2}-\d{2})", os.path.basename(path)) or \
        re.search(r"(20\d{2}-\d{2}-\d{2})", text)
    date = m.group(1) if m else ""

    # 主题
    m = re.search(r"^>\s*(?:主题|今日场景主线)[：:]\s*(.+?)$", text, re.M)
    theme = strip_md(m.group(1)).replace("**", "") if m else ""

    # 按 ## 切块
    blocks = re.split(r"\n##\s+", text)
    words = []
    for blk in blocks:
        head = blk.split("\n", 1)[0].strip()
        body = blk.split("\n", 1)[1] if "\n" in blk else ""

        # 标题形如 "1. truss　/trʌs/" 或 "gusset /ˈɡʌsɪt/" 或 "flange /flændʒ/ n. 翼缘"
        if not re.match(r"^(\d+\.\s*)?[A-Za-z][A-Za-z\-'\s]*", head):
            continue
        if head.startswith("今日小结") or head.startswith("串联场景") or head.startswith("词汇档案"):
            continue
        if not re.search(r"/", head[:60]):
            continue

        head = re.sub(r"^\d+\.\s*", "", head)
        w = {}

        # 单词本身：音标之前的字母与空格/连字符
        pre = head.split("/")[0]
        pre = re.sub(r"[（(].*?[)）]", "", pre)
        word = pre.strip().strip("　 ")
        if not word or len(word) > 40:
            continue
        w["word"] = word

        # 音标
        m = re.search(r"/([^/]{2,60})/", head)
        w["phonetic"] = ("/" + m.group(1).strip() + "/") if m else ""

        # 标题里可能带的词性 + 简义（第 5 期格式）
        tail = head.split("/")[-1] if "/" in head else ""
        m = re.search(r"\b(n|v|adj|adv|prep)\.\s*(.+)$", tail)
        head_short = m.group(2).strip() if m else ""

        # 词义
        m = re.search(r"\*\*词义\*\*[：:]\s*(.+?)(?=\n\*\*|\n---|\Z)", body, re.S)
        meaning = strip_md(m.group(1)).replace("\n", " ").strip() if m else ""
        if not meaning:
            meaning = head_short
        w["meaning"] = meaning

        # 常用搭配
        m = re.search(r"\*\*常用搭配\*\*[：:]\s*(.+?)(?=\n\*\*|\n---|\Z)", body, re.S)
        w["collocation"] = strip_md(m.group(1)).replace("\n", " ").strip() if m else ""

        # 例句（收集 - 开头的行，紧跟其后的括号行是译文）
        ex_block = re.search(r"\*\*例句\*\*[：:]?\s*(.+?)(?=\n\*\*|\n---|\Z)", body, re.S)
        examples = []
        if ex_block:
            lines = [l.rstrip() for l in ex_block.group(1).split("\n")]
            cur = None
            for l in lines:
                ls = l.strip()
                if ls.startswith("- ") or ls.startswith("（") or ls.startswith("("):
                    pass
                if re.match(r"^[-*]\s+", ls):
                    cur = re.sub(r"^[-*]\s+", "", ls)
                    examples.append([cur, ""])
                elif cur and (ls.startswith("（") or ls.startswith("(")):
                    examples[-1][1] = ls.strip("（）() ")
                elif cur and ls and not ls.startswith(">"):
                    # 单段落例句（第 5 期）：整行是英文，下一行是中文
                    examples[-1][0] = cur
        # 第 5 期：例句只有一行，中文在下一行
        if not examples:
            m2 = re.search(r"\*\*例句\*\*[：:]?\s*(.+?)\n\s*[（(](.+?)[）)]", body, re.S)
            if m2:
                examples = [[strip_md(m2.group(1)), m2.group(2).strip()]]
        w["examples"] = [{"en": strip_md(e).replace("**", ""), "zh": z} for e, z in examples]

        # 记忆提示
        m = re.search(r"\*\*记忆提示\*\*[：:]\s*(.+?)(?=\n---|\n##|\Z)", body, re.S)
        w["mnemonic"] = strip_md(m.group(1)).replace("\n", " ").strip() if m else ""

        w["issue"] = issue
        w["date"] = date
        w["theme"] = theme
        words.append(w)
    return words


def main():
    files = sorted(
        os.path.join(BASE, f)
        for f in os.listdir(BASE)
        if f.endswith(".md") and "每日五词" in f
    )
    all_words = []
    for fp in files:
        all_words.extend(parse_file(fp))

    # 合并已有人工修正
    old = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, "r", encoding="utf-8") as f:
                data = json.load(f)
            for w in data.get("words", []):
                old[w["word"].lower()] = w
        except Exception:
            pass

    # 人工补充字段（gloss / category）
    ov = {}
    if os.path.exists(OVERRIDES):
        try:
            with open(OVERRIDES, "r", encoding="utf-8") as f:
                ov = {k.lower(): v for k, v in json.load(f).items() if not k.startswith("_")}
        except Exception:
            ov = {}

    merged, seen = [], set()
    for w in all_words:
        key = w["word"].lower()
        if key in seen:
            continue
        seen.add(key)
        w["gloss"] = (ov.get(key, {}) or {}).get("gloss") or auto_gloss(w["meaning"])
        w["category"] = (ov.get(key, {}) or {}).get("category") or ""
        if key in old:
            for k, v in old[key].items():
                if k in ("examples",) and v:
                    w[k] = v
                elif v and not w.get(k):
                    w[k] = v
                elif k in ("meaning", "mnemonic", "collocation") and v:
                    w[k] = v   # 人工修正优先
        merged.append(w)

    merged.sort(key=lambda x: (x.get("date", ""), x.get("issue", 0)))

    # 挂接已生成的发音音频（保持与 audio/ 目录一致）
    def _slug(s):
        return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

    n_audio = 0
    for w in merged:
        rel = "audio/" + _slug(w["word"]) + ".mp3"
        if os.path.exists(os.path.join(ROOT, rel)):
            w["audio"] = rel
            n_audio += 1
        elif not os.path.exists(os.path.join(ROOT, w.get("audio") or "")):
            w["audio"] = ""
        # 例句整句发音
        for i, ex in enumerate(w.get("examples") or []):
            erel = "audio/ex/%s-%d.mp3" % (_slug(w["word"]), i + 1)
            if os.path.exists(os.path.join(ROOT, erel)):
                ex["audio"] = erel
    print("audio attached: %d/%d" % (n_audio, len(merged)))

    out = {
        "updated": __import__("datetime").date.today().isoformat(),
        "total": len(merged),
        "words": merged,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # 同步生成一份 JS 兜底数据（file:// 打开或 fetch 失败时使用）
    with open(os.path.join(ROOT, "words.js"), "w", encoding="utf-8") as f:
        f.write("window.__WORDS__ = ")
        json.dump(out, f, ensure_ascii=False)
        f.write(";\n")

    print(f"parsed {len(merged)} words -> {OUT}")
    for w in merged:
        print(f"  [{w['date']}] {w['word']:<20} {w['phonetic']:<22} {w['meaning'][:28]}  ex={len(w['examples'])} col={'Y' if w['collocation'] else 'N'} mn={'Y' if w['mnemonic'] else 'N'}")


if __name__ == "__main__":
    sys.exit(main())
