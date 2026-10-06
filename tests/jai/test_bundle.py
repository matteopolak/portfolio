import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("bundle", Path(__file__).resolve().parents[2] / "scripts/verify-jai-bundle.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
REVISION = "a" * 40


class BundleTests(unittest.TestCase):
    def fixture(self, transform=None, archive_transform=None):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        directory = Path(folder.name)
        data = {"index.html": b"<h1>Compiler</h1>", "worker.mjs": b"export {};",
                "jai_wasm.wasm": b"\0asm\x01\0\0\0", "modules/helper.jai": b"answer :: 42;"}
        manifest = {"schema_version": 1, "commit": REVISION, "dirty_checkout": False,
                    "entrypoint": "index.html", "files": [
                        {"path": name, "size": len(value), "sha256": hashlib.sha256(value).hexdigest()}
                        for name, value in data.items()]}
        if transform:
            transform(manifest, data)
        (directory / "jai-playground.manifest.json").write_text(json.dumps(manifest))
        with zipfile.ZipFile(directory / "jai-playground.zip", "w") as archive:
            if archive_transform:
                archive_transform(archive, data)
            else:
                for name, value in data.items():
                    archive.writestr(name, value)
        return directory

    def test_verified_nested_sources_are_staged(self):
        directory = self.fixture()
        bundle.verify(directory, REVISION)
        self.assertEqual((directory / "verified/modules/helper.jai").read_bytes(), b"answer :: 42;")

    def test_schema_two_tour_tree_is_staged(self):
        # Compiler releases with the language tour ship tour.json and nested tour/ sources.
        tour = {"tour.json": b'{"schema_version": 1, "main": "main.jai", "files": ["main.jai", "meta/macros.jai", "tour.md"]}',
                "tour/main.jai": b"main :: () {}", "tour/meta/macros.jai": b"m :: () #expand {}", "tour/tour.md": b"# Tour"}

        def schema_two(manifest, data):
            for name in ("index.html", "worker.mjs", "modules/helper.jai"):
                data.pop(name)
            data["jaifmt-playground.jai"] = b'TARGET :: "main.jai";'
            data.update(tour)
            manifest.update(schema_version=2, files=[
                {"path": name, "size": len(value), "sha256": hashlib.sha256(value).hexdigest()}
                for name, value in data.items()])
            manifest.pop("entrypoint")
        directory = self.fixture(schema_two)
        bundle.verify(directory, REVISION)
        for name, value in tour.items():
            self.assertEqual((directory / "verified" / name).read_bytes(), value)

    def test_revision_and_dirty_checkout_fail_before_staging(self):
        for key, value in [("commit", "b" * 40), ("dirty_checkout", True), ("schema_version", 2)]:
            directory = self.fixture(lambda manifest, _: manifest.update({key: value}))
            with self.assertRaises(ValueError):
                bundle.verify(directory, REVISION)
            self.assertFalse((directory / "verified").exists())

    def test_member_tampering_is_rejected(self):
        directory = self.fixture(archive_transform=lambda archive, data: [
            archive.writestr(name, b"export [];" if name == "worker.mjs" else value) for name, value in data.items()])
        with self.assertRaises(ValueError):
            bundle.verify(directory, REVISION)

    def test_extra_members_are_rejected(self):
        def archive_write(archive, data):
            for name, value in data.items():
                archive.writestr(name, value)
            archive.writestr("unlisted.js", b"")
        with self.assertRaises(ValueError):
            bundle.verify(self.fixture(archive_transform=archive_write), REVISION)

    def test_unsafe_reference_and_duplicate_paths_are_rejected(self):
        for name in ["../outside", "/outside", "modules/../../outside", "reference/example.jai", "./index.html", "C:/outside", "module\\file.jai"]:
            directory = self.fixture(lambda manifest, _: manifest["files"][0].update(path=name))
            with self.assertRaises(ValueError):
                bundle.verify(directory, REVISION)
        directory = self.fixture(lambda manifest, _: manifest["files"].append(manifest["files"][0]))
        with self.assertRaises(ValueError):
            bundle.verify(directory, REVISION)

    def test_symlink_member_is_rejected(self):
        def archive_write(archive, data):
            for name, value in data.items():
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = (0o120777 if name == "worker.mjs" else 0o100644) << 16
                archive.writestr(info, value)
        with self.assertRaises(ValueError):
            bundle.verify(self.fixture(archive_transform=archive_write), REVISION)

    def test_native_binary_and_invalid_wasm_are_rejected(self):
        for name, value in [("worker.mjs", b"\x7fELFbinary"), ("jai_wasm.wasm", b"not wasm")]:
            def change(manifest, data):
                data[name] = value
                next(record for record in manifest["files"] if record["path"] == name).update(
                    size=len(value), sha256=hashlib.sha256(value).hexdigest())
            with self.assertRaises(ValueError):
                bundle.verify(self.fixture(change), REVISION)


if __name__ == "__main__":
    unittest.main()
