#!/usr/bin/env bash
# 每日五词 · 发布到 GitHub Pages
# 用法：
#   bash tools/publish_github.sh            提交信息默认 "更新词库"
#   bash tools/publish_github.sh "2026-09-09 新词"
# Token 来源（任选其一）：环境变量 GH_TOKEN，或仓库上级目录 .gh_token 文件
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

MSG="${1:-更新词库}"

# 取 token（仅用于本次推送，不在仓库内留痕）
GH_TOKEN="${GH_TOKEN:-$(cat "$REPO_DIR/../.gh_token" 2>/dev/null || true)}"
if [ -z "$GH_TOKEN" ]; then
  echo "错误：未找到 GitHub Token（请设置环境变量 GH_TOKEN，或在上一级目录放 .gh_token 文件）" >&2
  exit 1
fi

# 确保 origin 指向带 token 的地址
REMOTE_CLEAN="https://github.com/yn818527-wq/daily-english.git"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_CLEAN"
fi
git remote add origin "$REMOTE_CLEAN" 2>/dev/null || true
git remote set-url origin "https://${GH_TOKEN}@github.com/yn818527-wq/daily-english.git"

git add -A
if git diff --cached --quiet; then
  echo "没有需要提交的变更"
else
  git commit -m "$MSG"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
echo "推送到 origin/$BRANCH ..."
git push origin "$BRANCH"

# 推送后抹除 remote 中的 token
git remote set-url origin "$REMOTE_CLEAN"
echo "完成。GitHub Pages 通常 1-2 分钟后生效。"
