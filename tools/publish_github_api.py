# -*- coding: utf-8 -*-
"""
每日五词 · 通过 GitHub REST API 发布到 GitHub Pages
（当沙箱/网络屏蔽了 git:// 与 https 到 github.com 的 Git 协议端口时的备用通道）

用法：
    python tools/publish_github_api.py "提交信息"

Token 来源：环境变量 GH_TOKEN，或仓库上级目录 .gh_token 文件。
只会上传与远端不一致的文件（按 git blob sha1 比对），音频等二进制走 base64。
"""
import base64
import hashlib
import json
import os
import sys

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # web/
OWNER = "yn818527-wq"
REPO = "daily-english"
BRANCH = "main"
API = "https://api.github.com"

SKIP_DIRS = {".git", "__pycache__", "node_modules"}
SKIP_FILES = {".ds_store", "thumbs.db"}


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
    """返回 [(相对路径, 绝对路径, 是否二进制)]"""
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

    # 1. 远端当前 commit / tree
    r = requests.get(f"{API}/repos/{OWNER}/{REPO}/branches/{BRANCH}", headers=H, timeout=30)
    r.raise_for_status()
    base_commit = r.json()["commit"]["sha"]
    base_tree = r.json()["commit"]["commit"]["tree"]["sha"]

    r = requests.get(
        f"{API}/repos/{OWNER}/{REPO}/git/trees/{base_tree}",
        headers=H, params={"recursive": "1"}, timeout=30
    )
    r.raise_for_status()
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

    print(f"本地文件 {len(files)} 个，需上传 {len(upload)} 个，删除 {len(set(remote) - {f[0] for f in files})} 个")

    # 3. 上传 blob（二进制用 base64）
    for rel, data, sha in upload:
        try:
            payload = {
                "content": base64.b64encode(data).decode("ascii"),
                "encoding": "base64",
            }
            rr = requests.post(f"{API}/repos/{OWNER}/{REPO}/git/blobs",
                               headers=H, json=payload, timeout=120)
            rr.raise_for_status()
        except Exception:
            # 纯文本可退回 utf-8 直接提交
            txt = data.decode("utf-8")
            rr = requests.post(f"{API}/repos/{OWNER}/{REPO}/git/blobs",
                               headers=H, json={"content": txt, "encoding": "utf-8"}, timeout=120)
            rr.raise_for_status()
        got = rr.json()["sha"]
        assert got == sha, f"blob sha 不一致: {rel}"
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": sha})
        print(f"  + {rel}")

    # 4. 删除远端已不存在的文件（sha 置 null）
    local_set = {f[0] for f in files}
    for p in sorted(set(remote) - local_set):
        tree.append({"path": p, "mode": "100644", "type": "blob", "sha": None})
        print(f"  - {p}")

    if not upload and not (set(remote) - local_set):
        print("没有需要提交的变更")
        return

    # 5. 建树
    rr = requests.post(f"{API}/repos/{OWNER}/{REPO}/git/trees",
                       headers=H, json={"base_tree": base_tree, "tree": tree}, timeout=60)
    rr.raise_for_status()
    new_tree = rr.json()["sha"]

    # 6. 建提交
    rr = requests.post(f"{API}/repos/{OWNER}/{REPO}/git/commits", headers=H, timeout=60,
                       json={"message": msg, "tree": new_tree, "parents": [base_commit]})
    rr.raise_for_status()
    new_commit = rr.json()["sha"]

    # 7. 更新分支引用
    rr = requests.patch(f"{API}/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
                        headers=H, json={"sha": new_commit}, timeout=60)
    rr.raise_for_status()

    print(f"已提交 {new_commit[:8]}：{msg}")
    print("完成。GitHub Pages 通常 1-2 分钟后生效。")


if __name__ == "__main__":
    main()
