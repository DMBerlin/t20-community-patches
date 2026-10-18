#!/usr/bin/env bash
# Creates (or reuses) the worktree of an issue, as a sibling of main in the .bare layout:
#   <project>/<issue>-<slug>  on branch  issue/<issue>-<slug>, based on origin/main.
# Usage: tools/worktree.sh <issue> [slug]   (slug defaults to the patch id in the issue title, or the title)
set -euo pipefail

issue="${1:?Usage: $0 <issue> [slug]}"
[[ "$issue" =~ ^[0-9]+$ ]] || { echo "Issue must be a number" >&2; exit 2; }
slug="${2:-}"
project=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)

if [[ -z "$slug" ]]; then
  existing=$(git for-each-ref --format='%(refname:short)' "refs/heads/issue/$issue-*" | head -1)
  if [[ -n "$existing" ]]; then
    slug=${existing#issue/$issue-}
  else
    title=$(gh issue view "$issue" --json title -q .title)
    slug=$(sed -nE 's/.*\(([a-z0-9]+(-[a-z0-9]+)*)\)[[:space:]]*$/\1/p' <<<"$title")
    [[ -n "$slug" ]] || slug=$(iconv -f UTF-8 -t ASCII//TRANSLIT <<<"$title" | tr '[:upper:]' '[:lower:]' |
      sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-40 | sed -E 's/-+$//')
  fi
fi

branch="issue/$issue-$slug"
dir="$project/$issue-$slug"

if [[ -d "$dir" ]]; then
  echo "Worktree already exists: $dir ($branch)"
elif git show-ref --verify --quiet "refs/heads/$branch"; then
  git worktree add -q "$dir" "$branch"
  echo "Worktree restored: $dir ($branch)"
else
  git fetch -q origin main
  git worktree add -q --no-track -b "$branch" "$dir" origin/main
  echo "Worktree created: $dir ($branch, from origin/main)"
fi
echo "$dir"
