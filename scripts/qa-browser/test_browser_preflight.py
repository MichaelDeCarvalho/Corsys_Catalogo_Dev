"""Dependency-free tests for QA browser preflight and network interception.

These exercise only synthetic URL/route objects; never launch Chromium or access a service.
"""
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_b2b_access_browser import guarded_context, require_loopback, selected_cases, verify_safe


class FakePage:
    def on(self, *args):
        pass


class FakeContext:
    def route(self, pattern, callback):
        assert pattern == "**/*"
        self.http_handler = callback

    def route_web_socket(self, pattern, callback):
        assert pattern == "**/*"
        self.ws_handler = callback

    def new_page(self):
        return FakePage()


class FakeBrowser:
    def new_context(self, **kwargs):
        self.options = kwargs
        self.context = FakeContext()
        return self.context


class FakeHttpRoute:
    def __init__(self, url):
        self.request = SimpleNamespace(url=url)
        self.result = None

    def continue_(self):
        self.result = "continued"

    def abort(self, code):
        self.result = "aborted:" + code


class FakeWsRoute:
    def __init__(self, url):
        self.url = url
        self.result = None

    def close(self, **kwargs):
        self.result = ("closed", kwargs.get("code"))

    def connect_to_server(self):
        self.result = ("connected",)


class BrowserPreflightTests(unittest.TestCase):
    def test_default_and_selective_cases(self):
        with patch.dict(os.environ, {"QA_B2B_CASES": "anon,pending,suspended,rejected"}):
            self.assertEqual(selected_cases(), ["anon", "pending", "suspended", "rejected"])
        with patch.dict(os.environ, {"QA_B2B_CASES": "anon"}):
            self.assertEqual(selected_cases(), ["anon"])
        with patch.dict(os.environ, {"QA_B2B_CASES": "suspended,rejected"}):
            self.assertEqual(selected_cases(), ["suspended", "rejected"])

    def test_case_selector_fails_closed(self):
        for value in ["", "anon,anon", "all", "anon,production", "pending,", ",rejected"]:
            with self.subTest(value=value), patch.dict(os.environ, {"QA_B2B_CASES": value}):
                with self.assertRaises(SystemExit):
                    selected_cases()

    def test_url_validator_allows_only_explicit_loopback_origin(self):
        for value in ["http://127.0.0.1:54321", "http://localhost:5173", "https://[::1]:54321"]:
            with self.subTest(value=value), patch.dict(os.environ, {"QA_BASE_URL": value}):
                self.assertEqual(require_loopback("QA_BASE_URL"), value)

    def test_url_validator_rejects_hosted_or_embedded_credentials(self):
        for value in [
            "https://project.supabase.co",
            "https://example.com:443",
            "http://127.0.0.2:54321",
            "http://localhost:5173/checkout",
            "http://localhost:5173?debug=true",
            "http://localhost:5173#frag",
            "http://a:password@localhost:5173",
            "file:///tmp/index.html",
            "http://localhost",
        ]:
            with self.subTest(value=value), patch.dict(os.environ, {"QA_BASE_URL": value}):
                with self.assertRaises(SystemExit):
                    require_loopback("QA_BASE_URL")

    def test_blocked_external_font_requests_do_not_invalidate_isolated_qa(self):
        verify_safe([], ["fonts.googleapis.com", "fonts.gstatic.com"])
        with self.assertRaises(AssertionError):
            verify_safe([], ["example.supabase.co"])
        with self.assertRaises(AssertionError):
            verify_safe(["private-catalog"], [])

    def test_http_and_websocket_routes_are_restricted(self):
        browser = FakeBrowser()
        _ctx, _page, requests, unexpected = guarded_context(
            browser, "http://127.0.0.1:5173", "http://127.0.0.1:54321"
        )
        self.assertEqual(browser.options["service_workers"], "block")
        self.assertFalse(browser.options["accept_downloads"])
        for address in ["http://127.0.0.1:5173/", "http://127.0.0.1:54321/rest/v1"]:
            route = FakeHttpRoute(address)
            browser.context.http_handler(route)
            self.assertEqual(route.result, "continued")
        for address in ["https://supabase.co", "http://127.0.0.1:5555/", "http://localhost:54321/"]:
            route = FakeHttpRoute(address)
            browser.context.http_handler(route)
            self.assertEqual(route.result, "aborted:blockedbyclient")

        for address in ["ws://127.0.0.1:5173/", "ws://127.0.0.1:54321/realtime/v1/websocket"]:
            ws = FakeWsRoute(address)
            browser.context.ws_handler(ws)
            self.assertEqual(ws.result, ("connected",))
        for address in ["wss://example.com/ws", "ws://127.0.0.1:4444/ws", "ws://localhost:54321/ws"]:
            ws = FakeWsRoute(address)
            browser.context.ws_handler(ws)
            self.assertEqual(ws.result, ("closed", 1008))
        self.assertEqual(len(unexpected), 6)
        self.assertEqual(requests, [])


if __name__ == "__main__":
    unittest.main()
