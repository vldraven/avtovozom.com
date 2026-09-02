"""Tests for combined SSL verification bundle."""

from __future__ import annotations

import unittest

import httpx

from app.http_ssl import http_verify


class HttpSslTests(unittest.TestCase):
    def test_verify_max_api(self):
        with httpx.Client(timeout=15.0, verify=http_verify()) as client:
            resp = client.get("https://platform-api2.max.ru/")
        self.assertLess(resp.status_code, 500)

    def test_verify_public_letsencrypt(self):
        with httpx.Client(timeout=15.0, verify=http_verify()) as client:
            resp = client.get("https://api.avtovozom.com/health")
        self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()
