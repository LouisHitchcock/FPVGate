"""Offline packaging checks; no firmware builds, flashing or release writes."""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_release", ROOT / "tools/package_release.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackagingTests(unittest.TestCase):
    def run_package(self, *args):
        with patch.object(sys, "argv", ["package_release", *args]), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return package.main()

    def test_real_partition_offsets(self):
        previous = Path.cwd()
        try:
            os.chdir(ROOT)
            for board, size, _ in package.BOARDS:
                self.assertEqual(int(package.filesystem_offset(board), 0), 0x610000 if size == "16MB" else 0x410000)
        finally:
            os.chdir(previous)

    def test_complete_kit_and_fail_closed(self):
        previous = Path.cwd()
        with tempfile.TemporaryDirectory(prefix="fpvgate-packaging-") as temporary:
            try:
                os.chdir(temporary)
                build = Path(".pio/build/ESP32S3")
                build.mkdir(parents=True)
                for part in package.PARTS:
                    (build / f"{part}.bin").write_bytes(f"test-{part}".encode())
                boot = Path(temporary) / "boot_app0.bin"
                boot.write_bytes(b"test-otadata")
                with patch.object(package, "BOOT_APP0", str(boot)), patch.object(package, "filesystem_offset", return_value="0x410000"):
                    self.assertEqual(self.run_package("--version", "v1.9.0-alpha-test", "--only", "ESP32S3", "--skip-build"), 0)
                    kit = Path("release/v1.9.0-alpha-test")
                    for part in package.PARTS:
                        self.assertEqual((kit / f"ESP32S3-{part}.bin").read_bytes(), (kit / "ESP32S3" / f"{part}.bin").read_bytes())
                        self.assertEqual((kit / "boards" / f"ESP32S3-8MB-{part}.bin").read_bytes(), (build / f"{part}.bin").read_bytes())
                    instructions = (kit / "ESP32S3-FLASH_INSTRUCTIONS.txt").read_text()
                    self.assertIn("0xe000   boot_app0.bin", instructions)
                    self.assertIn("0x410000  ESP32S3-littlefs.bin", instructions)
                    self.assertEqual((kit / "boot_app0.bin").read_bytes(), b"test-otadata")
                    sums = (kit / "SHA256SUMS").read_text().splitlines()
                    self.assertEqual(len(sums), 15)
                    for row in sums:
                        digest, relative = row.split("  ", 1)
                        self.assertEqual(hashlib.sha256((kit / relative).read_bytes()).hexdigest(), digest)
                    (build / "littlefs.bin").unlink()
                    self.assertEqual(self.run_package("--version", "v1.9.0-incomplete", "--only", "ESP32S3", "--skip-build"), 1)
                    self.assertFalse(Path("release/v1.9.0-incomplete").exists())
                    (build / "littlefs.bin").write_bytes(b"test-fs")
                    boot.unlink()
                    self.assertEqual(self.run_package("--version", "v1.9.0-no-otadata", "--only", "ESP32S3", "--skip-build"), 1)
                    self.assertFalse(Path("release/v1.9.0-no-otadata").exists())
                    for bad in ("../../outside", "v1.9.0/escape", "v1.9.0;echo"):
                        with self.assertRaises(SystemExit):
                            self.run_package("--version", bad, "--skip-build")
                    with self.assertRaises(SystemExit):
                        self.run_package("--version", "v1.9.0", "--only", "ESP32S3", "typo", "--skip-build")
            finally:
                os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
