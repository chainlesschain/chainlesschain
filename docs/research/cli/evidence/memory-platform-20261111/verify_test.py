"""Exercise rejection boundaries using retained original receipts."""
import copy
import gzip
import json
import unittest

import verify


class ReceiptAuditTests(unittest.TestCase):
    def setUp(self):
        self.report = json.loads(gzip.decompress(
            (verify.HERE / "raw/local-stop-100-failed.json.gz").read_bytes()))

    def test_original_failure_is_retained(self):
        result = verify.audit_stop(self.report)
        self.assertFalse(result["targetMet"])
        self.assertEqual(sum(c["limitViolations"] for c in result["cases"]), 2)

    def test_false_green_aggregate_is_rejected(self):
        report = copy.deepcopy(self.report)
        report["targetMet"] = True
        with self.assertRaisesRegex(ValueError, "overall Stop target"):
            verify.audit_stop(report)

    def test_missing_sample_is_rejected(self):
        report = copy.deepcopy(self.report)
        report["tiers"][0]["modes"]["validate-disk"]["samples"].pop()
        with self.assertRaisesRegex(ValueError, "missing Stop samples"):
            verify.audit_stop(report)

    def test_completed_work_cannot_be_counted_as_ack(self):
        report = copy.deepcopy(self.report)
        sample = next(s for s in report["tiers"][0]["modes"]["verified-memory"]["samples"]
                      if s["outcome"] == "completed")
        sample["outcome"] = "aborted"
        with self.assertRaisesRegex(ValueError, "false ACK"):
            verify.audit_stop(report)

    def test_wrong_source_digest_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "source mismatch"):
            verify.verify_git_bindings({
                ("6338e6a1b1310af6a6164d799ab544ed0bc15668",
                 "packages/cli/scripts/memory-query-responsiveness-benchmark.mjs"): "0" * 64})


if __name__ == "__main__":
    unittest.main()
