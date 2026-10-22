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

    def test_release_google_remains_fail_closed(self) -> None:
        # PR #6 (unpaid) still has the original backend-exclusion guard on
        # its own branch. This development branch may contain staged Google
        # code but MUST NOT activate it or allow a billable unbounded call.
        estimate = ROOT / "supabase/functions/estimate-delivery/index.ts"
        usage = ROOT / "supabase/migrations/20261011032224_google_routes_usage_limits.sql"
        burst = ROOT / "supabase/migrations/20261011035235_google_routes_burst_protection.sql"
        config = (ROOT / "vite.config.ts").read_text(encoding="utf-8")
        self.assertIn("RELEASE_BLOCKED_GOOGLE_ROUTES", config)
        if estimate.exists():
            self.assertTrue(usage.is_file() and burst.is_file(),
                            "Staged Google backend must include global quota migrations")
            code = estimate.read_text(encoding="utf-8")
            self.assertIn('Deno.env.get("GOOGLE_ROUTES_ENABLED") !== "true"', code)
            self.assertIn('reserve_google_routes_attempt', code)
            self.assertNotIn('reserveAttempt: async () => true', code)
            self.assertNotIn('Math.abs(hash % 20000)', code)
        else:
            self.assertFalse(usage.exists())
            self.assertFalse(burst.exists())
        self.assertTrue(
            (ROOT / "supabase/migrations/20261016000000_000023_checkout_idempotency_buyer_guard.sql").is_file()
        )
        self.assertTrue((ROOT / "docs/qa/PR6_SELECTIVE_MIGRATION_000023_RUNBOOK_20261019.md").is_file())


if __name__ == "__main__":
    unittest.main()
