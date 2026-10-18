#!/usr/bin/env bash
# Points Foundry's module folder at a worktree through a symlink, so Foundry loads that worktree.
#   tools/active.sh link [dir]   Link the worktree containing [dir] (default: current directory).
#   tools/active.sh status       Show which worktree Foundry is loading.
# Foundry data folder: $FOUNDRY_DATA (default: macOS location).
set -euo pipefail

id=t20-community-patches
data="${FOUNDRY_DATA:-$HOME/Library/Application Support/FoundryVTT/Data}"
link="$data/modules/$id"

case "${1:-status}" in
  status)
    if [[ -L "$link" ]]; then
      target=$(readlink "$link")
      echo "Foundry → $target ($(git -C "$target" branch --show-current 2>/dev/null || echo "missing"))"
    elif [[ -e "$link" ]]; then
      echo "$link is a real folder (not managed by make active)"
    else
      echo "Not linked: $link"
    fi
    ;;
  link)
    target=$(git -C "${2:-.}" rev-parse --show-toplevel)
    [[ -d "$data/modules" ]] || { echo "Foundry data folder not found: $data (set FOUNDRY_DATA)" >&2; exit 1; }
    [[ "$(node -p "require('$target/module.json').id" 2>/dev/null)" == "$id" ]] || { echo "$target is not a $id worktree" >&2; exit 1; }
    if [[ -e "$link" && ! -L "$link" ]]; then
      echo "Refusing to replace a real folder: $link (move it away first)" >&2
      exit 1
    fi
    previous=$(readlink "$link" 2>/dev/null || true)
    ln -sfn "$target" "$link"
    echo "Foundry → $target ($(git -C "$target" branch --show-current))"
    [[ -n "$previous" && "$previous" != "$target" ]] && echo "   was: $previous"
    if [[ -n "$previous" && -f "$previous/module.json" ]] && ! cmp -s "$previous/module.json" "$target/module.json"; then
      echo "module.json differs from the previous worktree: restart Foundry so it re-reads the manifest."
    else
      echo "Reload the world in the browser (F5) to load this worktree."
    fi
    ;;
  *)
    echo "Usage: $0 link [dir] | status" >&2
    exit 2
    ;;
esac
