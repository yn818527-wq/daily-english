# -*- coding: utf-8 -*-
"""
每日五词 · 通过 GitHub REST API 发布到 GitHub Pages
（当沙箱/网络屏蔽了 git:// 与 https 到 github.com 的 Git 协议端口时的备用通道）

用法：
    python tools/publish_github_api.py "提交信息"

Token 来源：环境变量 GH_TOKEN，或仓库上级目录 .gh_token 文件。
只会上传与远端不一致的文件（按 git blob sha1 比对），音频等二进制走 base64。

请求通道说明（重要，勿回退到 requests）：
    沙箱到 api.github.com 用 Python requests 时两条路都间歇性失败：
      - 走系统代理（注册表注入 127.0.0.1:7897）：偶发 ProxyError / RemoteDisconnected
      - 直连（trust_env=False）：偶发 getaddrinfo 解析失败
    且单个请求 timeout 在重试里累积可拖到十几分钟。而 curl 子进程直连实测稳定 200。
    因此统一用 curl：--max-time 硬性限时（不会无限挂），body 走 stdin，配合 req 退避重试。
"""
import base64
import time
import hashlib
import json
import os
import sys
import subprocess
from urllib.parse import urlencode

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # web/
OWNER = "yn818527-wq"
REPO = "daily-english"
BRANCH = "main"
API = "https://api.github.com"

SKIP_DIRS = {".git", "__pycache__", "node_modules"}
SKIP_FILES = {".ds_store", "thumbs.db"}

CODE_MARK = "__WB_HTTP__"


class _Resp:
    """模拟 requests.Response 的最小接口（.json / .raise_for_status）"""

    def __init__(self, code, text):
        self.status_code = code
        self.text = text

    def raise_for_status(self):
        if not (200 <= self.status_code < 300):
            raise RuntimeError("HTTP %d: %s" % (self.status_code, self.text[:200]))

    def json(self):
        return json.loads(self.text)


def token():
    t = os.environ.get("GH_TOKEN", "").strip()
    if not t:
        p = os.path.join(os.path.dirname(ROOT), ".gh_token")
        if os.path.exists(p):
            t = open(p, "r", encoding="utf-8").read().strip()
    if not t:
        sys.exit("错误：未找到 GitHub Token（GH_TOKEN 或上一级目录 .gh_token）")
    return t


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def local_files():
    """返回 [(相对路径, 绝对路径)]"""
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.lower() in SKIP_FILES:
                continue
            ap = os.path.join(dirpath, fn)
            rel = os.path.relpath(ap, ROOT).replace("\\", "/")
            out.append((rel, ap))
    return sorted(out)


def main():
    msg = sys.argv[1] if len(sys.argv) > 1 else "更新词库"
    tok = token()
    H = {
        "Authorization": "Bearer " + tok,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    def req(method, url, tries=6, **kw):
        """curl 子进程发请求：--max-time 硬限时 + stdin 传 body + 退避重试。"""
        headers = dict(H)
        body_bytes = None
        if "json" in kw:
            body_bytes = json.dumps(kw["json"], ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if kw.get("params"):
            url = url + "?" + urlencode(kw["params"])
        # 硬性上限，避免像 requests 那样在重试里累积挂十几分钟
        max_time = min(int(kw.get("timeout", 30)), 60)

        cmd = ["curl", "-sS", "-X", method, "--max-time", str(max_time),
               "-w", "\n" + CODE_MARK + "%{http_code}"]
        for k, v in headers.items():
            cmd += ["-H", "%s: %s" % (k, v)]
        if body_bytes is not None:
            cmd += ["--data-binary", "@-"]
        cmd.append(url)

        last = None
        for i in range(tries):
            try:
                p = subprocess.run(cmd, input=body_bytes, capture_output=True,
                                   timeout=max_time + 10)
                out = p.stdout.decode("utf-8", "replace")
                if CODE_MARK in out:
                    text, code = out.rsplit(CODE_MARK, 1)
                    resp = _Resp(int(code.strip()), text)
                else:
                    err = p.stderr.decode("utf-8", "replace")[:150]
                    raise RuntimeError("curl 无状态码 (rc=%d): %s" % (p.returncode, err))
                resp.raise_for_status()
                return resp
            except Exception as e:
                last = e
                if i < tries - 1:
                    print("  ! %s %s 重试 %d/%d：%s" % (
                        method, url.split("/repos/")[-1], i + 1, tries - 1, type(e).__name__))
                    time.sleep(min(2 * (i + 1), 6))
        raise last

    # 1. 远端当前 commit / tree
    r = req("GET", f"{API}/repos/{OWNER}/{REPO}/branches/{BRANCH}", timeout=30)
    base_commit = r.json()["commit"]["sha"]
    base_tree = r.json()["commit"]["commit"]["tree"]["sha"]

    r = req("GET", f"{API}/repos/{OWNER}/{REPO}/git/trees/{base_tree}",
            params={"recursive": "1"}, timeout=30)
    remote = {i["path"]: i["sha"] for i in r.json().get("tree", []) if i["type"] == "blob"}

    # 2. 找出需要上传的文件
    files = local_files()
    tree = []
    upload = []
    for rel, ap in files:
        with open(ap, "rb") as f:
            data = f.read()
        sha = blob_sha(data)
        if remote.get(rel) == sha:
            tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": sha})
        else:
            upload.append((rel, data, sha))

    print("本地文件 %d 个，需上传 %d 个，删除 %d 个" % (
        len(files), len(upload), len(set(remote) - {f[0] for f in files})), flush=True)

    # 3. 上传 blob（二进制用 base64）
    for rel, data, sha in upload:
        payload = {
            "content": base64.b64encode(data).decode("ascii"),
            "encoding": "base64",
        }
        rr = req("POST", f"{API}/repos/{OWNER}/{REPO}/git/blobs", json=payload, timeout=120)
        got = rr.json()["sha"]
        assert got == sha, "blob sha 不一致: %s" % rel
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": sha})
        print("  + %s" % rel, flush=True)

    # 4. 删除远端已不存在的文件（sha 置 null）
    local_set = {f[0] for f in files}
    for p in sorted(set(remote) - local_set):
        tree.append({"path": p, "mode": "100644", "type": "blob", "sha": None})
        print("  - %s" % p, flush=True)

    if not upload and not (set(remote) - local_set):
        print("没有需要提交的变更")
        return

    # 5. 建树
    rr = req("POST", f"{API}/repos/{OWNER}/{REPO}/git/trees", timeout=60,
             json={"base_tree": base_tree, "tree": tree})
    new_tree = rr.json()["sha"]

    # 6. 建提交
    rr = req("POST", f"{API}/repos/{OWNER}/{REPO}/git/commits", timeout=60,
             json={"message": msg, "tree": new_tree, "parents": [base_commit]})
    new_commit = rr.json()["sha"]

    # 7. 更新分支引用
    req("PATCH", f"{API}/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
        timeout=60, json={"sha": new_commit})

    print("已提交 %s：%s" % (new_commit[:8], msg), flush=True)
    print("完成。GitHub Pages 通常 1-2 分钟后生效。")


if __name__ == "__main__":
    main()
