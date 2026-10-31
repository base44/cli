#!/usr/bin/env bash
# One-off: let base44-builder-dev[bot] trigger the Claude workflows in base44/cli.
# Clones base44/cli into a temp dir, edits allowed_bots in 3 workflow files,
# pushes branch ci/allow-builder-bot and opens a PR (needs git + push access; gh optional).
set -euo pipefail

REPO="base44/cli"
BRANCH="ci/allow-builder-bot"
BOT="base44-builder-dev[bot]"
FILES=(.github/workflows/claude-code-review.yml .github/workflows/pr-description.yml .github/workflows/claude.yml)

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  URL="https://github.com/${REPO}.git"
  gh auth setup-git >/dev/null 2>&1 || true
else
  URL="git@github.com:${REPO}.git"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "Cloning ${REPO} into ${WORK} ..."
git clone --quiet --depth 1 "$URL" "$WORK/cli"
cd "$WORK/cli"

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already exists on origin; aborting so nothing is overwritten." >&2
  exit 1
fi

git checkout --quiet -b "$BRANCH"
for f in "${FILES[@]}"; do
  if grep -q "base44-builder-dev\[bot\]" "$f"; then
    echo "  $f already allows ${BOT}, skipping"
    continue
  fi
  # Append the bot to the existing allowed_bots list: allowed_bots: 'a,b' -> 'a,b,base44-builder-dev[bot]'
  sed -i.bak -E "s/^([[:space:]]*allowed_bots: '[^']*)'/\1,${BOT}'/" "$f" && rm -f "$f.bak"
  grep -q "base44-builder-dev\[bot\]" "$f" || { echo "Failed to edit $f" >&2; exit 1; }
  echo "  updated $f"
done

if git diff --quiet; then
  echo "Nothing to change: main already allows ${BOT}."
  exit 0
fi

echo
git --no-pager diff
echo
read -r -p "Commit, push ${BRANCH} and open a PR? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

git commit --quiet -am "ci: allow base44-builder-dev[bot] to trigger Claude workflows"
git push --quiet -u origin "$BRANCH"

BODY="Adds \`base44-builder-dev[bot]\` to \`allowed_bots\` in claude-code-review.yml, pr-description.yml and claude.yml so claude-review / generate-description stop failing with 'Workflow initiated by non-human actor' on PRs opened by the Base44 builder bot (e.g. #685)."
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh pr create --repo "$REPO" --base main --head "$BRANCH" \
    --title "ci: allow base44-builder-dev[bot] to trigger Claude workflows" --body "$BODY"
else
  echo "Pushed. Open the PR here: https://github.com/${REPO}/compare/main...${BRANCH}?expand=1"
fi
