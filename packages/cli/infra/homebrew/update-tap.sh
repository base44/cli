#!/usr/bin/env bash
#
# Update the Homebrew tap formula with a new version and SHA256 checksums.
#
# Usage: GH_TOKEN=<token> bash update-tap.sh <version> <binaries-dir>
#
# The script:
#   1. Computes SHA256 for each platform archive
#   2. Renders the formula template (base44.rb) with the real values
#   3. Clones base44/homebrew-tap, commits, and pushes
#
set -euo pipefail

VERSION="$1"
BINARIES_DIR="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SHA_DARWIN_ARM64=$(shasum -a 256 "$BINARIES_DIR/base44-darwin-arm64.tar.gz" | awk '{print $1}')
SHA_DARWIN_X64=$(shasum -a 256 "$BINARIES_DIR/base44-darwin-x64.tar.gz" | awk '{print $1}')
SHA_LINUX_ARM64=$(shasum -a 256 "$BINARIES_DIR/base44-linux-arm64.tar.gz" | awk '{print $1}')
SHA_LINUX_X64=$(shasum -a 256 "$BINARIES_DIR/base44-linux-x64.tar.gz" | awk '{print $1}')

cp "$SCRIPT_DIR/base44.rb" /tmp/base44.rb
sed -i "s/version \".*\"/version \"$VERSION\"/" /tmp/base44.rb
sed -i "s/PLACEHOLDER_DARWIN_ARM64/$SHA_DARWIN_ARM64/" /tmp/base44.rb
sed -i "s/PLACEHOLDER_DARWIN_X64/$SHA_DARWIN_X64/" /tmp/base44.rb
sed -i "s/PLACEHOLDER_LINUX_ARM64/$SHA_LINUX_ARM64/" /tmp/base44.rb
sed -i "s/PLACEHOLDER_LINUX_X64/$SHA_LINUX_X64/" /tmp/base44.rb

rm -rf /tmp/homebrew-tap
git clone "https://x-access-token:${GH_TOKEN}@github.com/base44/homebrew-tap.git" /tmp/homebrew-tap
mkdir -p /tmp/homebrew-tap/Formula
cp /tmp/base44.rb /tmp/homebrew-tap/Formula/base44.rb

cd /tmp/homebrew-tap
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add Formula/base44.rb
if git diff --cached --quiet; then
  echo "Homebrew formula already up to date"
  exit 0
fi
git commit -m "Update base44 to ${VERSION}"
git push origin master
