#!/usr/bin/env bash
# 每日五词 · 发布到 GitHub Pages（带自动降级）
#
# 用法：
#   bash tools/publish_github.sh            提交信息默认 "更新词库"
#   bash tools/publish_github.sh "2026-09-10 每日五词"
#
# 通道选择：
#   1) 先探测 github.com:443 的 TLS 连通性（8s 超时）
#   2) 通 → 走常规 git push（60s 上限，防止挂死）
#   3) 不通或超时 → 自动降级到 tools/publish_github_api.py，走 GitHub REST API 直推
#      （部分沙箱屏蔽 github.com，但仍放行 api.github.com）
#
# Token 来源（任选其一）：环境变量 GH_TOKEN，或仓库上级目录 .gh_token 文件
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

MSG="${1:-更新词库}"
REMOTE_CLEAN="https://github.com/yn818527-wq/daily-english.git"

# 取 token（仅用于本次推送，不在仓库内留痕）
GH_TOKEN="${GH_TOKEN:-$(cat "$REPO_DIR/../.gh_token" 2>/dev/null || true)}"
if [ -z "$GH_TOKEN" ]; then
  echo "错误：未找到 GitHub Token（请设置环境变量 GH_TOKEN，或在上一级目录放 .gh_token 文件）" >&2
  exit 1
fi

PY="C:/Users/Admin/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
[ -x "$PY" ] || PY="python"

# ---------- 连通性探测 ----------
if ! curl -sS -o /dev/null --max-time 8 https://github.com 2>/dev/null; then
  echo "[publish] github.com:443 不可达（沙箱网络限制），自动降级为 GitHub REST API 通道"
  exec "$PY" tools/publish_github_api.py "$MSG"
fi

# ---------- 常规 git push 通道 ----------
# 确保提交身份存在（避免 "Please tell me who you are" 中断）
git config user.email >/dev/null 2>&1 || git config user.email "yn818527-wq@users.noreply.github.com"
git config user.name  >/dev/null 2>&1 || git config user.name  "yn818527-wq"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_CLEAN"
else
  git remote add origin "$REMOTE_CLEAN" 2>/dev/null || true
fi
git remote set-url origin "https://${GH_TOKEN}@github.com/yn818527-wq/daily-english.git"

git add -A
if git diff --cached --quiet; then
  echo "[publish] 没有需要提交的变更"
else
  git commit -m "$MSG"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
echo "[publish] 推送到 origin/$BRANCH ..."

export GIT_TERMINAL_PROMPT=0
if timeout 60 git push origin "$BRANCH"; then
  git remote set-url origin "$REMOTE_CLEAN"
  echo "[publish] 完成。GitHub Pages 通常 1-2 分钟后生效。"
  exit 0
fi

# ---------- 降级 ----------
git remote set-url origin "$REMOTE_CLEAN"
echo "[publish] git push 失败或超时（>60s），降级为 GitHub REST API 通道"
exec "$PY" tools/publish_github_api.py "$MSG"
