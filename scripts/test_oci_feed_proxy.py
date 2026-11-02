import os
import unittest
import importlib.util
from pathlib import Path

os.environ["FEED_PROXY_TOKEN"] = "test-relay-token-only-not-a-wallet-key" * 2
spec = importlib.util.spec_from_file_location("oci_feed_proxy", Path(__file__).with_name("oci-feed-proxy.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
allowed_target = module.allowed_target


class FeedPaths(unittest.TestCase):
    def test_allowed_reads(self):
        for path in ["/feed/state", "/feed/actions?limit=50", "/feed/journal?limit=200&after=0x" + "a" * 64, "/feed/evidence/0x" + "b" * 64]:
            self.assertTrue(allowed_target(path), path)

    def test_denied_paths_and_queries(self):
        for path in ["/agent.env", "/feed/../../agent.env", "/feed/state?upstream=http://evil.example", "/feed/actions?limit=201", "/feed/actions?limit=1&limit=2", "/feed/journal?after=invalid", "http://evil.example/feed/state", "/feed/prompts/not-a-hash"]:
            self.assertFalse(allowed_target(path), path)


if __name__ == "__main__":
    unittest.main()
