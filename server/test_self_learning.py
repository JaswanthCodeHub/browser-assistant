"""Regression coverage: opt-in memory must not affect existing routes."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from self_learning import Lesson, erase_lessons, learning_status, record_lesson, retrieve_lessons


class LearningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict(os.environ, {
            "SELF_LEARNING_ENABLED": "true",
            "LEARNING_DB_PATH": str(Path(self.tmp.name) / "isolated.db"),
        })
        env.start()
        self.addCleanup(env.stop)

    def payload(self, **overrides):
        values = dict(task_type="coding", url="https://example.org/task",
                      problem="How to reverse a Python list?",
                      lesson="Use the reverse method when mutation is intended.",
                      verified=True, consent=True)
        values.update(overrides)
        return Lesson(**values)

    def test_store_and_retrieve_verified_lesson(self):
        response = record_lesson(self.payload())
        self.assertTrue(response["stored"])
        result = retrieve_lessons("coding", "https://example.org/other",
                                  "How to reverse a Python list?", 5)
        self.assertEqual(len(result["items"]), 1)
        self.assertIn("reverse method", result["items"][0]["lesson"])

    def test_does_not_return_other_tasks_or_sites(self):
        record_lesson(self.payload())
        self.assertEqual(retrieve_lessons("mcq", "https://example.org/task",
                        "How to reverse a Python list?", 5)["items"], [])
        self.assertEqual(retrieve_lessons("coding", "https://elsewhere.org/task",
                        "How to reverse a Python list?", 5)["items"], [])

    def test_requires_verification_and_consent(self):
        for changes in ({"verified": False}, {"consent": False}):
            with self.assertRaises(HTTPException) as raised:
                record_lesson(self.payload(**changes))
            self.assertEqual(raised.exception.status_code, 422)

    def test_redacts_credentials(self):
        record_lesson(self.payload(lesson="Never paste password=hunter2 into a task."))
        result = retrieve_lessons("coding", "https://example.org/task",
                                  "How to reverse a Python list?", 5)
        self.assertNotIn("hunter2", result["items"][0]["lesson"])

    def test_clear_only_learning_history(self):
        record_lesson(self.payload())
        erase_lessons()
        self.assertFalse(retrieve_lessons("coding", "https://example.org/task",
                                         "How to reverse a Python list?", 5)["items"])

    def test_disabled_by_default_and_no_learning_writes(self):
        with patch.dict(os.environ, {"SELF_LEARNING_ENABLED": "false"}):
            self.assertFalse(learning_status()["enabled"])
            with self.assertRaises(HTTPException) as raised:
                record_lesson(self.payload())
            self.assertEqual(raised.exception.status_code, 403)
        self.assertFalse((Path(self.tmp.name) / "isolated.db").exists())


if __name__ == "__main__":
    unittest.main()
