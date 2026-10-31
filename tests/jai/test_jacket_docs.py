import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/stage-jacket-docs.py"
REVISION = "b" * 40


class JacketDocsTests(unittest.TestCase):
    def tarball(self, entries):
        """entries: name -> bytes (a file), None (a directory) or ("link", TarInfo type)."""
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "docs.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            for name, value in entries.items():
                info = tarfile.TarInfo(name)
                if value is None:
                    info.type = tarfile.DIRTYPE
                    archive.addfile(info)
                elif isinstance(value, tuple):
                    info.type = value[1]
                    info.linkname = "index.html"
                    archive.addfile(info)
                else:
                    info.size = len(value)
                    archive.addfile(info, io.BytesIO(value))
        return path

    def run_script(self, *args):
        return subprocess.run([sys.executable, "-I", str(SCRIPT), *map(str, args)],
                              capture_output=True, text=True)

    def site(self):
        return {"./": None, "./index.html": b"<h1>Docs</h1>", "./api/Basic/print.html": b"print",
                "./runtime/jai_wasm.wasm": b"\0asm", "./runtime/engine.mjs": b"export {}",
                "./runtime.json": b'{"engine": "runtime/engine.mjs", "wasm": "runtime/jai_wasm.wasm"}'}

    def test_the_site_is_staged_on_the_playground_compiler(self):
        path = self.tarball(self.site())
        out = path.parent / "public/docs/jacket"
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        result = self.run_script(path, REVISION, "--sha256", digest, "--out", out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((out / "api/Basic/print.html").read_bytes(), b"print")
        self.assertFalse((out / "runtime").exists())
        self.assertEqual(json.loads((out / "runtime.json").read_text()),
                         {"engine": f"/jai/{REVISION}/engine.mjs", "wasm": f"/jai/{REVISION}/jai_wasm.wasm"})
        # Staging again replaces the old site.
        (out / "stale.html").write_text("old")
        self.assertEqual(self.run_script(path, REVISION, "--out", out).returncode, 0)
        self.assertFalse((out / "stale.html").exists())

    def test_a_check_without_out_writes_nothing(self):
        path = self.tarball(self.site())
        result = self.run_script(path, REVISION)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Checked 5 docs files", result.stdout)

    def test_unsafe_or_wrong_tarballs_are_refused(self):
        cases = {
            "checksum": (self.site(), ["--sha256", "0" * 64]),
            "traversal": ({**self.site(), "../escape.html": b"x"}, []),
            "absolute": ({**self.site(), "/etc/escape": b"x"}, []),
            "symlink": ({**self.site(), "link.html": ("link", tarfile.SYMTYPE)}, []),
            "hardlink": ({**self.site(), "link.html": ("link", tarfile.LNKTYPE)}, []),
            "no index": ({"api/x.html": b"x"}, []),
        }
        for label, (entries, args) in cases.items():
            with self.subTest(label):
                path = self.tarball(entries)
                result = self.run_script(path, REVISION, *args, "--out", path.parent / "out")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("jacket docs:", result.stderr)
                self.assertFalse((path.parent / "out").exists())
                self.assertFalse((path.parent.parent / "escape.html").exists())


if __name__ == "__main__":
    unittest.main()
