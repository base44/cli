# Homebrew formula for the Base44 CLI.
#
# This is a reference template. Copy it to your homebrew-tap repository
# at Formula/base44.rb and update the version + SHA256 values on each release.
#
# Users install with:
#   brew install <org>/tap/base44
#
class Base44 < Formula
  desc "CLI for creating, managing, and deploying Base44 applications"
  homepage "https://github.com/base44/cli"
  version "0.0.37"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/base44/cli/releases/download/v#{version}/base44-darwin-arm64"
      sha256 "PLACEHOLDER_DARWIN_ARM64"
    else
      url "https://github.com/base44/cli/releases/download/v#{version}/base44-darwin-x64"
      sha256 "PLACEHOLDER_DARWIN_X64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/base44/cli/releases/download/v#{version}/base44-linux-arm64"
      sha256 "PLACEHOLDER_LINUX_ARM64"
    else
      url "https://github.com/base44/cli/releases/download/v#{version}/base44-linux-x64"
      sha256 "PLACEHOLDER_LINUX_X64"
    end
  end

  def install
    binary_name = stable.url.split("/").last
    bin.install binary_name => "base44"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/base44 --version")
  end
end
