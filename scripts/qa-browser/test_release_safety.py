#!/usr/bin/env python3
"""Fail-closed source guard for PR #6: no privileged deploy in GitHub Actions.

This test is intentionally offline. It cannot inspect Cloudflare dashboard,
Supabase Hosted migration history or remote automation; those release gates
remain human-reviewed and separately authorized.
"""
from __future__ import annotations

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"

# Disallow privileged commands in ALL repository workflows for this PR.
# Explicit deployment requires separate authorization and review of this guard.
FORBIDDEN = (
    re.compile(r"\bsupabase\s+db\s+push\b", re.I),
    re.compile(r"\bsupabase\s+migration\s+up\b", re.I),
    re.compile(r"\bsupabase\s+functions\s+deploy\b", re.I),
    re.compile(r"\bsupabase\s+link\b", re.I),
    re.compile(r"\b(?:npx\s+)?wrangler\s+deploy\b", re.I),
    re.compile(r"\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?deploy\b", re.I),
)

class ReleaseSafetyGuard(unittest.TestCase):
    def test_workflows_do_not_execute_privileged_deployments(self) -> None:
        self.assertTrue(WORKFLOWS.is_dir(), "GitHub workflow directory missing")
        files = sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml"))
        self.assertTrue(files, "No workflows available to validate")
        for path in files:
            lines = path.read_text(encoding="utf-8").splitlines()
            for number, line in enumerate(lines, 1):
                stripped = line.lstrip()
                if stripped.startswith("#"):
                    continue
                for pattern in FORBIDDEN:
                    with self.subTest(workflow=path.name, line=number, command=pattern.pattern):
                        self.assertNotRegex(line, pattern,
                            "Privileged deploy detected in CI workflow: explicit release gate required")

    def test_google_routes_stays_disabled_in_isolated_ci(self) -> None:
        path = WORKFLOWS / "qa-isolated.yml"
        self.assertTrue(path.is_file(), "Isolated QA workflow missing")
        data = path.read_text(encoding="utf-8")
        self.assertRegex(data, r"(?m)^\s+VITE_GOOGLE_ROUTES_UI_ENABLED:\s*['\"]false['\"]\s*$")
        self.assertNotRegex(data, r"(?m)^\s+GOOGLE_ROUTES_ENABLED:\s*['\"]?true['\"]?\s*$")

    def test_release_excludes_unapproved_paid_google_backend(self) -> None:
        # This PR intentionally carries the unpaid/manual-delivery release ONLY.
        # The paid Google SQL, Edge entrypoint and DB tests are preserved on
        # hold/google-routes-after-pr6-20261021 for a separately approved release.
        excluded = (
            ROOT / "supabase/migrations/20261011032224_google_routes_usage_limits.sql",
            ROOT / "supabase/migrations/20261011035235_google_routes_burst_protection.sql",
            ROOT / "supabase/functions/estimate-delivery/index.ts",
            ROOT / "supabase/tests/database/05_google_routes_usage_test.sql",
            ROOT / "supabase/tests/database/06_google_routes_burst_test.sql",
        )
        for path in excluded:
            with self.subTest(path=str(path.relative_to(ROOT))):
                self.assertFalse(path.exists(), "Paid Google backend unexpectedly included in release")
        config = (ROOT / "supabase/config.toml").read_text(encoding="utf-8")
        self.assertNotIn("[functions.estimate-delivery]", config)
        self.assertTrue(
            (ROOT / "supabase/migrations/20261016000000_000023_checkout_idempotency_buyer_guard.sql").is_file()
        )
        runbook = ROOT / "docs/qa/PR6_SELECTIVE_MIGRATION_000023_RUNBOOK_20261019.md"
        self.assertTrue(runbook.is_file())
        self.assertIn("db push", runbook.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
