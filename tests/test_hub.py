import importlib.util
import pathlib
import unittest

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
        self.assertTrue(rows[0]["protected"])


if __name__ == "__main__":
    unittest.main()
