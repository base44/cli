#!/usr/bin/env python3
import contextlib
import io
import pathlib
import re
import tempfile
import textwrap
import unittest

import yaml

import check_wix_proxy_steps as checker

COMPLIANT_WORKFLOW = """\
name: Good
on:
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Wix gateway proxy (mandatory)
        uses: ./.github/actions/wix-gateway-proxy
"""

WORKFLOWS = frozenset({".github/workflows/pr-agent-scope.yml"})

PROXY_STEP = """\
- name: Wix gateway proxy (mandatory)
  uses: ./.github/actions/wix-gateway-proxy
"""

COMPLIANT = {
    "plain checkout then proxy": """
        steps:
          - uses: actions/checkout@v7
          <proxy>
    """,
    "pinned-sha checkout then proxy": """
        steps:
          - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
          <proxy>
    """,
    "cone sparse checkout of .github": """
        steps:
          - uses: actions/checkout@v7
            with:
              sparse-checkout: .github
          <proxy>
    """,
    "cone sparse checkout listing both paths": """
        steps:
          - uses: actions/checkout@v7
            with:
              sparse-checkout: |
                .github/actions/publish-pr-insight
                .github/actions/wix-gateway-proxy
                .github/certs
          <proxy>
    """,
    "non-cone sparse checkout listing both paths": """
        steps:
          - uses: actions/checkout@v7
            with:
              sparse-checkout: |
                .github/scripts/forward_pr_comment.py
                .github/actions/wix-gateway-proxy
                .github/certs
              sparse-checkout-cone-mode: false
          <proxy>
    """,
    "job-level if is fine": """
        if: github.event_name == 'pull_request'
        steps:
          - uses: actions/checkout@v7
          <proxy>
    """,
    "local reusable workflow call": """
        uses: ./.github/workflows/pr-agent-scope.yml
    """,
}

VIOLATIONS = {
    "no proxy step at all": ("""
        steps:
          - uses: actions/checkout@v7
          - run: npm ci
    """, "does not run the Wix gateway proxy"),

    "proxy as the very first step": ("""
        steps:
          <proxy>
          - uses: actions/checkout@v7
    """, "needs a checkout before it"),

    "proxy after an unrelated step": ("""
        steps:
          - uses: actions/checkout@v7
          - uses: actions/setup-node@v4
          <proxy>
    """, "at step 3"),

    "proxy behind an if": ("""
        steps:
          - uses: actions/checkout@v7
          - name: Wix gateway proxy (mandatory)
            if: github.event_name == 'push'
            uses: ./.github/actions/wix-gateway-proxy
    """, "behind an if:"),

    "proxy behind a falsy if that skips the step": ("""
        steps:
          - uses: actions/checkout@v7
          - name: Wix gateway proxy (mandatory)
            if: false
            uses: ./.github/actions/wix-gateway-proxy
    """, "behind an if:"),

    "proxy behind a null if": ("""
        steps:
          - uses: actions/checkout@v7
          - name: Wix gateway proxy (mandatory)
            if: null
            uses: ./.github/actions/wix-gateway-proxy
    """, "behind an if:"),

    "proxy allowed to fail": ("""
        steps:
          - uses: actions/checkout@v7
          - name: Wix gateway proxy (mandatory)
            continue-on-error: true
            uses: ./.github/actions/wix-gateway-proxy
    """, "continue-on-error"),

    "proxy given an empty proxy-ip": ("""
        steps:
          - uses: actions/checkout@v7
          - name: Wix gateway proxy (mandatory)
            uses: ./.github/actions/wix-gateway-proxy
            with:
              proxy-ip: ''
    """, "empty proxy-ip"),

    "preceded by a run step": ("""
        steps:
          - run: echo hello
          <proxy>
    """, "instead of a checkout"),

    "checkout into a subdirectory": ("""
        steps:
          - uses: actions/checkout@v7
            with:
              path: repo
          <proxy>
    """, "checkout into repo/"),

    "checkout of another repository": ("""
        steps:
          - uses: actions/checkout@v7
            with:
              repository: wix-private/base44-mobile
          <proxy>
    """, "checkout of wix-private/base44-mobile"),

    "non-cone sparse checkout omitting the certs": ("""
        steps:
          - uses: actions/checkout@v7
            with:
              sparse-checkout: |
                .github/actions/wix-gateway-proxy
              sparse-checkout-cone-mode: false
          <proxy>
    """, "omits"),

    "cone sparse checkout of an unrelated directory": ("""
        steps:
          - uses: actions/checkout@v7
            with:
              sparse-checkout: .github/scripts
          <proxy>
    """, "omits"),

    "sparse checkout negating the certs directory": ("""
        steps:
          - uses: actions/checkout@v7
            with:
              sparse-checkout: |
                .github
                !.github/certs
              sparse-checkout-cone-mode: false
          <proxy>
    """, "omits"),

    "sparse checkout negating the cert file inside the directory": ("""
        steps:
          - uses: actions/checkout@v7
            with:
              sparse-checkout: |
                .github
                !.github/certs/wix-embargo.pem
              sparse-checkout-cone-mode: false
          <proxy>
    """, "omits"),

    "external reusable workflow call": ("""
        uses: wix-private/shared/.github/workflows/build.yml@main
    """, "cannot verify"),

    "reusable call to a workflow that does not exist": ("""
        uses: ./.github/workflows/pr-agent-scoep.yml
    """, "cannot verify"),
}


def job(source: str) -> dict:
    expanded = re.sub(
        r"^( *)<proxy>$",
        lambda match: textwrap.indent(PROXY_STEP, match.group(1)),
        textwrap.dedent(source),
        flags=re.MULTILINE,
    )
    return yaml.safe_load(expanded)


class JobProblemTests(unittest.TestCase):
    def test_compliant_jobs_pass(self):
        for label, source in COMPLIANT.items():
            with self.subTest(job=label):
                self.assertIsNone(checker.job_problem(job(source), WORKFLOWS))

    def test_violations_are_reported(self):
        for label, (source, expected) in VIOLATIONS.items():
            with self.subTest(job=label):
                problem = checker.job_problem(job(source), WORKFLOWS)
                self.assertIsNotNone(problem, f"{label} should have been rejected")
                self.assertIn(expected, problem)


class JobLineTests(unittest.TestCase):
    def test_job_ids_map_to_their_line_numbers(self):
        text = textwrap.dedent("""\
            name: Example
            on:
              pull_request:

            jobs:
              build:
                runs-on: ubuntu-latest
                steps:
                  - run: echo build
              deploy:
                runs-on: ubuntu-latest
                steps:
                  - run: echo deploy
        """)

        self.assertEqual(checker._job_lines(text), {"build": 6, "deploy": 10})


@contextlib.contextmanager
def fixture_repo(**workflows: str):
    """A throwaway repo root containing just .github/workflows/<name>."""
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        directory = root / ".github" / "workflows"
        directory.mkdir(parents=True)
        for name, content in workflows.items():
            (directory / f"{name}.yml").write_text(content, encoding="utf-8")
        yield root


def run_main(root: pathlib.Path) -> tuple[int, str]:
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        code = checker.main(root)
    return code, stdout.getvalue()


class MainTests(unittest.TestCase):
    def test_offending_job_is_annotated_at_its_own_line(self):
        bad = textwrap.dedent("""\
            name: Bad
            on:
              pull_request:

            jobs:
              build:
                runs-on: ubuntu-latest
                steps:
                  - uses: actions/checkout@v7
                  - run: npm ci
        """)

        with fixture_repo(bad=bad) as root:
            code, output = run_main(root)

        self.assertEqual(code, 1)
        self.assertIn(
            '::error file=.github/workflows/bad.yml,line=6::'
            'Job "build" does not run the Wix gateway proxy.',
            output,
        )
        self.assertIn("sparse-checkout: .github", output)

    def test_compliant_workflow_passes(self):
        with fixture_repo(good=COMPLIANT_WORKFLOW) as root:
            code, output = run_main(root)

        self.assertEqual(code, 0)
        self.assertIn("verified 1 of 1 jobs", output)

    def test_empty_and_comment_only_workflows_are_skipped(self):
        with fixture_repo(
            good=COMPLIANT_WORKFLOW,
            empty="",
            commented="# workflow temporarily disabled\n",
        ) as root:
            code, output = run_main(root)

        self.assertEqual(code, 0)
        self.assertIn("verified 1 of 1 jobs", output)

    def test_job_with_no_body_is_reported_as_missing_the_proxy(self):
        with fixture_repo(stub="name: Stub\non:\n  pull_request:\n\njobs:\n  build:\n") as root:
            code, output = run_main(root)

        self.assertEqual(code, 1)
        self.assertIn('Job "build" does not run the Wix gateway proxy.', output)


class RepositoryTests(unittest.TestCase):
    def test_every_job_in_this_repository_runs_the_proxy(self):
        self.assertEqual(checker.main(), 0)


if __name__ == "__main__":
    unittest.main()
