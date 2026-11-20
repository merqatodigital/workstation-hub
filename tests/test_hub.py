import importlib.util
import os
import pathlib
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("merqato_hub", ROOT / "hub" / "hub.py")
hub = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(hub)


class ProbeSummaryTests(unittest.TestCase):
    def test_failure_names_are_complete(self):
        probes = [
            {"host": "command.merqato.digital", "code": 502, "ok": False, "ms": 10, "slow": False},
            {"host": "sanvic.palawancollective.com", "code": 0, "ok": False, "ms": 10, "slow": False},
            {"host": "susi.merqato.digital", "code": 0, "ok": False, "ms": 10, "slow": False},
            {"host": "www.palawancollective.com", "code": 526, "ok": False, "ms": 10, "slow": False},
            {"host": "www.sanvic.palawancollective.com", "code": 0, "ok": False, "ms": 10, "slow": False},
            {"host": "www.status.merqato.digital", "code": 0, "ok": False, "ms": 10, "slow": False},
            {"host": "home.merqato.digital", "code": 401, "ok": True, "ms": 10, "slow": False},
        ]

        summary = hub.summarize_probes(probes)

        self.assertEqual(summary["failing"], 6)
        self.assertEqual(len(summary["failing_hosts"]), 6)
        self.assertIn("www.sanvic.palawancollective.com", summary["failing_names"])
        self.assertIn("www.status.merqato.digital", summary["failing_names"])
        self.assertGreater(len(summary["failing_names"]), 120)

    def test_empty_failure_list(self):
        summary = hub.summarize_probes([])
        self.assertEqual(summary["failing_names"], "none")
        self.assertEqual(summary["failing_hosts"], [])


class ProjectNormalizationTests(unittest.TestCase):
    def test_inventory_rows_are_normalized_for_the_ui(self):
        rows = hub.normalize_projects([
            {
                "project": "example",
                "deploymentURL": "https://example.vercel.app",
                "repo": "owner/example",
                "repoURL": "https://github.com/owner/example",
                "vercelTeam": "team",
                "state": "error",
                "updatedAt": 123,
                "protected": True,
            }
        ])

        self.assertEqual(rows[0]["name"], "example")
        self.assertEqual(rows[0]["state"], "ERROR")
        self.assertEqual(rows[0]["provider"], "Vercel")
        self.assertEqual(rows[0]["url"], "https://example.vercel.app")
        self.assertTrue(rows[0]["protected"])

    def test_canonical_domain_is_preferred_over_deployment_url(self):
        rows = hub.normalize_projects([{
            "project": "example",
            "domains": ["example.com", "example.vercel.app"],
            "deploymentURL": "https://deployment.vercel.app",
        }])

        self.assertEqual(rows[0]["url"], "https://example.com")

    def test_unsafe_http_urls_are_rejected(self):
        for value in (
            "javascript:alert(1)",
            "https://user:password@example.com",
            "https://example.com/\njavascript:alert(1)",
        ):
            self.assertEqual(hub.safe_http_url(value), "")

    def test_malformed_rows_are_skipped_without_losing_valid_rows(self):
        rows = hub.normalize_projects([
            None,
            "not-a-row",
            {"project": "unsafe", "deploymentURL": "javascript:alert(1)", "repoURL": "data:text/html,x"},
            {"project": "valid", "deploymentURL": "https://valid.example.com"},
        ])

        self.assertEqual([row["name"] for row in rows], ["valid"])
        self.assertEqual(rows[0]["url"], "https://valid.example.com")
        self.assertEqual(rows[0]["repoUrl"], "")


class SecurityAndEnvironmentTests(unittest.TestCase):
    def test_alert_webhook_fails_closed_without_a_key(self):
        self.assertFalse(hub.alert_key_matches("anything", ""))
        self.assertFalse(hub.alert_key_matches("", ""))
        self.assertFalse(hub.alert_key_matches("wrong", "right"))
        self.assertTrue(hub.alert_key_matches("right", "right"))

    def test_integer_environment_values_use_safe_defaults(self):
        with mock.patch.dict(os.environ, {"TEST_HUB_INT": ""}, clear=False):
            self.assertEqual(hub.env_int("TEST_HUB_INT", 60), 60)
        with mock.patch.dict(os.environ, {"TEST_HUB_INT": "not-an-int"}, clear=False):
            self.assertEqual(hub.env_int("TEST_HUB_INT", 60), 60)
        with mock.patch.dict(os.environ, {"TEST_HUB_INT": "12"}, clear=False):
            self.assertEqual(hub.env_int("TEST_HUB_INT", 60), 12)


if __name__ == "__main__":
    unittest.main()
