"""A history list or wrong saved record must never become an edit target."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from race_history_response import saved_race


class SavedRaceTests(unittest.TestCase):
    def test_returns_requested_record(self):
        race = {'timestamp': 123, 'pilots': []}
        self.assertIs(saved_race({'races': [race]}, 123), race)

    def test_rejects_shadowed_history_response_even_if_requested_record_present(self):
        with self.assertRaises(ValueError):
            saved_race({'races': [{'timestamp': 456}, {'timestamp': 123}]}, 123)

    def test_rejects_wrong_id_and_invalid_shapes(self):
        for payload in [None, [], {}, {'races': []}, {'races': {}},
                        {'races': [None]}, {'races': [{'timestamp': 456}]},
                        {'races': [{'timestamp': '123'}]}]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                saved_race(payload, 123)


if __name__ == '__main__':
    unittest.main()
