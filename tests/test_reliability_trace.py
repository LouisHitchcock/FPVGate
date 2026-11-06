import importlib.util
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('reliability', Path(__file__).resolve().parents[1] / 'tools/reliability_check.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def trace(times=(10, 20), count=None):
    return b'FGRH' + struct.pack('<BHIB', 2, 20, len(times) if count is None else count, 0) + b''.join(
        struct.pack('<I8B', t, *range(8)) for t in times)


class TraceTests(unittest.TestCase):
    def test_valid_binary_and_legacy(self):
        self.assertEqual(module.rssi_sample_counts(trace()), (2, 2))
        self.assertEqual(module.rssi_sample_counts(b'{"sampleCount":2,"samples":[1,2]}'), (2, 2))

    def test_truncation_version_interval_flags_and_order(self):
        for data in (b'FGRH', trace()[:-1], trace((20, 10)),
                     trace()[:4]+b'\x03'+trace()[5:],
                     trace()[:5]+b'\0\0'+trace()[7:],
                     trace()[:11]+b'\x02'+trace()[12:]):
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    module.rssi_sample_counts(data)

    def test_declared_count_mismatch_is_exposed_to_diagnostic(self):
        self.assertEqual(module.rssi_sample_counts(trace(count=3)), (3, 2))


if __name__ == '__main__':
    unittest.main()
