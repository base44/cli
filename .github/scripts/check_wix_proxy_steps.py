#!/usr/bin/env python3
"""Fail if any GitHub Actions job skips the mandatory Wix gateway proxy action.

There is no per-job opt-out marker by design. A job that genuinely cannot run the
proxy changes this script in the same PR, so the exception gets reviewed in the
open — which is exactly how PUBLISH_WORKFLOWS below came to exist.
"""

from __future__ import annotations

import pathlib
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
PROXY_ACTION = "./.github/actions/wix-gateway-proxy"
# The action copies .github/certs/wix-embargo.pem via a path relative to itself,
# so a sparse checkout has to materialize both directories.
REQUIRED_PATHS = (".github/actions/wix-gateway-proxy", ".github/certs")

# Publish workflows, exempt from the gateway by secplatform's interim policy for
# OSS repos: the gateway cannot carry `npm publish`, so these rely on the
# committed lockfile plus bunfig.toml's minimumReleaseAge instead.
#
# Adding a file here drops its embargo protection. That is a security decision,
# not a formality — do not do it lightly.
PUBLISH_WORKFLOWS = frozenset(
    {
        ".github/workflows/manual-publish.yml",
        ".github/workflows/preview-publish.yml",
    }
)

FIX_HINT = """Every job must run the Wix gateway proxy immediately after a checkout that
puts it on disk, or that job's npm installs bypass the Wix embargo gateway.

Job that already checks out this repo first:

    - uses: actions/checkout@v7

    - name: Wix gateway proxy (mandatory)
      uses: ./.github/actions/wix-gateway-proxy

Job with no leading same-repo checkout -- prepend a bootstrap one. The action
installs the CA under /usr/local/share, so a later full checkout does not undo it:

    - name: Checkout for wix gateway proxy
      uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      with:
        sparse-checkout: .github

    - name: Wix gateway proxy (mandatory)
      uses: ./.github/actions/wix-gateway-proxy

Non-cone sparse checkout -- list both paths explicitly:

      with:
        sparse-checkout: |
          <your existing paths>
          .github/actions/wix-gateway-proxy
          .github/certs
        sparse-checkout-cone-mode: false
"""


def _uses(step: dict) -> str:
    return str(step.get("uses", "")).strip().rstrip("/")


def _covers(pattern: str, path: str) -> bool:
    return path == pattern or path.startswith(pattern + "/")


def _overlaps(pattern: str, path: str) -> bool:
    # An exclusion breaks the action whether it removes the whole directory or a
    # single file inside it, so overlap in either direction disqualifies.
    return _covers(pattern, path) or _covers(path, pattern)


def _sparse_covers_action(patterns: str) -> bool:
    listed = [p.strip().rstrip("/") for p in patterns.splitlines() if p.strip()]
    included = [p for p in listed if not p.startswith("!")]
    excluded = [p[1:] for p in listed if p.startswith("!")]
    return all(
        any(_covers(p, required) for p in included)
        and not any(_overlaps(p, required) for p in excluded)
        for required in REQUIRED_PATHS
    )


def _checkout_problem(step: dict) -> str | None:
    if not _uses(step).startswith("actions/checkout"):
        return f'is preceded by "{_uses(step) or "a run step"}" instead of a checkout'
    with_ = step.get("with") or {}
    if with_.get("repository"):
        return f'is preceded by a checkout of {with_["repository"]}'
    if with_.get("path"):
        return f'is preceded by a checkout into {with_["path"]}/, not the workspace root'
    patterns = with_.get("sparse-checkout")
    if patterns and not _sparse_covers_action(str(patterns)):
        return "is preceded by a sparse checkout that omits " + " or ".join(REQUIRED_PATHS)
    return None


def job_problem(job: dict, workflows: frozenset[str]) -> str | None:
    """Describe why this job fails to run the proxy, or None if it runs it correctly."""
    if "uses" in job:
        target = str(job["uses"]).strip()
        if target.removeprefix("./") in workflows:
            return None
        return f"calls {target}, whose jobs this check cannot verify"

    steps = job.get("steps") or []
    index = next((i for i, s in enumerate(steps) if _uses(s) == PROXY_ACTION), None)
    if index is None:
        return "does not run the Wix gateway proxy"
    if index == 0:
        return "runs the Wix gateway proxy first, but a local action needs a checkout before it"
    if index > 1:
        return f"runs the Wix gateway proxy at step {index + 1}; it must be step 2"
    step = steps[index]
    # Presence, not truthiness: `if: false` parses to False and would skip the step.
    if "if" in step:
        return "guards the Wix gateway proxy behind an if:, but it is mandatory"
    if step.get("continue-on-error"):
        return "lets the Wix gateway proxy fail via continue-on-error, but it is mandatory"
    with_ = step.get("with") or {}
    if "proxy-ip" in with_ and not str(with_["proxy-ip"]).strip():
        return "passes an empty proxy-ip, leaving registry.npmjs.org resolving publicly"
    return _checkout_problem(steps[0])


def _job_lines(text: str) -> dict[str, int]:
    document = yaml.compose(text)
    if document is None:
        return {}
    for key, value in document.value:
        if key.value == "jobs":
            return {job.value: job.start_mark.line + 1 for job, _ in value.value}
    return {}


def main(repo_root: pathlib.Path = REPO_ROOT) -> int:
    workflows_dir = repo_root / ".github" / "workflows"
    paths = sorted(p for p in workflows_dir.iterdir() if p.suffix in (".yml", ".yaml"))
    workflows = frozenset(p.relative_to(repo_root).as_posix() for p in paths)
    problems = []
    jobs = calls = 0
    exempt_paths = set()

    for path in paths:
        rel = path.relative_to(repo_root).as_posix()
        if rel in PUBLISH_WORKFLOWS:
            exempt_paths.add(rel)
            continue
        text = path.read_text(encoding="utf-8")
        lines = _job_lines(text)
        for job_id, job in ((yaml.safe_load(text) or {}).get("jobs") or {}).items():
            job = job or {}
            jobs += 1
            calls += "uses" in job
            problem = job_problem(job, workflows)
            if problem:
                problems.append((path.relative_to(repo_root), lines[job_id], job_id, problem))

    for path, line, job_id, problem in problems:
        print(f'::error file={path},line={line}::Job "{job_id}" {problem}.')

    if problems:
        print(f"\n{len(problems)} job(s) skip the Wix gateway proxy.\n")
        print(FIX_HINT)
        return 1

    print(
        f"Wix gateway proxy: verified {jobs - calls} of {jobs} jobs across "
        f"{len(paths) - len(exempt_paths)} workflows ({calls} reusable-workflow calls "
        f"delegate to the workflow they call)."
    )
    if exempt_paths:
        print("Publish workflows exempt by policy: " + ", ".join(sorted(exempt_paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
