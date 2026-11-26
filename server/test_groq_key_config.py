import os
import unittest
from unittest.mock import patch

import main


class GroqKeyConfigurationTests(unittest.TestCase):
    def test_all_seven_keys_are_loaded_in_order(self):
        values = {('GROQ_API_KEY' if i == 1 else f'GROQ_API_KEY_{i}'): f'fixture-{i}' for i in range(1, 8)}
        with patch.dict(os.environ, values, clear=True):
            self.assertEqual(main.load_groq_keys(), [f'fixture-{i}' for i in range(1, 8)])

    def test_sparse_duplicate_empty_and_placeholder_keys(self):
        with patch.dict(os.environ, {
            'GROQ_API_KEY': ' fixture ', 'GROQ_API_KEY_2': 'fixture',
            'GROQ_API_KEY_3': ' ', 'GROQ_API_KEY_4': 'your_groq_api_key_here',
            'GROQ_API_KEY_7': 'last', 'GROQ_API_KEY_8': 'ignored',
        }, clear=True):
            self.assertEqual(main.load_groq_keys(), ['fixture', 'last'])
