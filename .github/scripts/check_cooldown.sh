#!/usr/bin/env bash
# Prove the supply-chain cooldown in bunfig.toml actually rejects a fresh release.
#
# Requested by Dima Ryskin (Wix secplatform) as the review for #597: "i think the
# best 'review' would be a test. Can we stack another PR on top of that and check
# if installing a fresh-package is rejected? I used
# npmjs.com/package/electron-nightly for always 'fresh' versions".
#
# This MUST run without the Wix embargo gateway. With the gateway in front,
# embargo would refuse the fresh version itself and the run would prove nothing
# about Bun's guardrail — which is what the publish workflows actually rely on.
#
# Three cases, because "it errored" is not the only pass and not the only failure:
#   control      a long-stable package still installs, so a red result means the
#                cooldown fired rather than the probe being broken
#   floating     `bun add <pkg>` must not land a version inside the cooldown —
#                either refused, or silently resolved to an older one
#   exact pin    `bun add <pkg>@<fresh-version>` must be refused. This is the
#                bypass path that matters: a PR pinning an exact fresh version.
#
# Linux/GNU only (runs on ubuntu-latest). Age arithmetic is done in Node to avoid
# date(1) portability problems.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRESH_PKG="electron-nightly" # publishes nightly, so its latest is always fresh
CONTROL_PKG="lodash"         # unchanged for years; must install

# Read the policy from bunfig.toml rather than hardcoding it, so this test cannot
# drift away from the setting it is supposed to be verifying.
COOLDOWN_SECONDS="$(sed -nE 's/^[[:space:]]*minimumReleaseAge[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' "$REPO_ROOT/bunfig.toml" | head -1)"
if [ -z "$COOLDOWN_SECONDS" ]; then
  echo "FAIL: no minimumReleaseAge found in bunfig.toml — nothing to verify"
  exit 1
fi
echo "Cooldown under test: ${COOLDOWN_SECONDS}s ($((COOLDOWN_SECONDS / 86400)) days)"
echo "Bun: $(bun --version)"
echo

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$REPO_ROOT/bunfig.toml" "$WORK/bunfig.toml"
cd "$WORK"
printf '{ "name": "cooldown-probe", "private": true, "version": "0.0.0" }\n' >package.json

failures=0

# Age in seconds of a specific published version, per the registry's own metadata.
published_age_seconds() {
  curl -sS "https://registry.npmjs.org/$1" | node -e "
    let raw = '';
    process.stdin.on('data', (d) => (raw += d)).on('end', () => {
      const when = JSON.parse(raw).time?.['$2'];
      if (!when) { console.error('no publish time for $1@$2'); process.exit(1); }
      console.log(Math.floor((Date.now() - Date.parse(when)) / 1000));
    });
  "
}

echo "── control: bun add $CONTROL_PKG ──────────────────────────────"
if bun add "$CONTROL_PKG" >control.log 2>&1; then
  echo "PASS  control package installed, so the probe environment works"
else
  echo "FAIL  control package could not install — the probe is broken, not the cooldown"
  sed 's/^/      /' control.log
  failures=$((failures + 1))
fi
echo

echo "── floating: bun add $FRESH_PKG ───────────────────────────────"
if bun add "$FRESH_PKG" >floating.log 2>&1; then
  resolved="$(node -p "require('$WORK/node_modules/$FRESH_PKG/package.json').version")"
  age="$(published_age_seconds "$FRESH_PKG" "$resolved")" || age=""
  if [ -z "$age" ]; then
    echo "FAIL  installed $resolved but could not determine its publish time"
    failures=$((failures + 1))
  elif [ "$age" -ge "$COOLDOWN_SECONDS" ]; then
    echo "PASS  resolved $resolved, published ${age}s ago (>= cooldown)"
    echo "      fresh versions were filtered out of resolution"
  else
    echo "FAIL  installed $resolved, published only ${age}s ago — inside the cooldown"
    failures=$((failures + 1))
  fi
else
  echo "PASS  bun refused to install $FRESH_PKG"
  sed 's/^/      /' floating.log | tail -5
fi
echo

echo "── exact pin: bun add $FRESH_PKG@<newest> ─────────────────────"
newest="$(curl -sS "https://registry.npmjs.org/$FRESH_PKG" | node -e "
  let raw = '';
  process.stdin.on('data', (d) => (raw += d)).on('end', () => {
    const doc = JSON.parse(raw);
    console.log(doc['dist-tags'].nightly ?? doc['dist-tags'].latest);
  });
")"
newest_age="$(published_age_seconds "$FRESH_PKG" "$newest")" || newest_age=""
echo "Newest published: $newest (${newest_age:-unknown}s old)"

if [ -n "$newest_age" ] && [ "$newest_age" -ge "$COOLDOWN_SECONDS" ]; then
  echo "SKIP  newest version is already older than the cooldown; nothing fresh to reject"
  echo "      (unexpected for $FRESH_PKG — check it is still publishing nightly)"
elif bun add "$FRESH_PKG@$newest" >pinned.log 2>&1; then
  echo "FAIL  an exact pin bypassed the cooldown and installed $newest"
  echo "      a PR pinning a fresh version would defeat the guardrail"
  failures=$((failures + 1))
else
  echo "PASS  bun refused the exact fresh pin $newest"
  sed 's/^/      /' pinned.log | tail -5
fi
echo

if [ "$failures" -gt 0 ]; then
  echo "RESULT: $failures check(s) failed — the cooldown does not hold"
  exit 1
fi
echo "RESULT: cooldown holds — fresh releases cannot enter the dependency tree"
