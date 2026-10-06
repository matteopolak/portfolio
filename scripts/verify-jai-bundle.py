"""Validate a Jai release inventory before writing regular files to a new directory."""
import hashlib
import json
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


def verify(directory, revision):
    manifest = json.loads((directory / "jai-playground.manifest.json").read_text())
    # Schema 1 bundles carried the compiler repo's own playground page; schema 2 ships only the
    # wasm, its engine and the jaifmt driver, which is all this site uses.
    schema = manifest.get("schema_version")
    if (schema not in (1, 2) or manifest.get("commit") != revision
            or manifest.get("dirty_checkout") is not False
            or (schema == 1 and manifest.get("entrypoint") != "index.html")):
        raise ValueError("Jai manifest identity mismatch")
    records = manifest.get("files")
    if not isinstance(records, list) or not 1 <= len(records) <= 4096:
        raise ValueError("Invalid Jai inventory")
    expected = {}
    for record in records:
        name = record["path"]
        parts = PurePosixPath(name).parts
        if (not isinstance(name, str) or not name or "\\" in name or "\x00" in name
                or name.startswith("/") or any(p in (".", "..", "reference") for p in name.split("/"))
                or str(PurePosixPath(name)) != name or ":" in name or not parts
                or name in expected or Path(name).suffix.lower() in (".exe", ".dll", ".so", ".dylib")):
            raise ValueError("Unsafe or duplicate Jai file")
        size = record["size"]
        if type(size) is not int or not 0 <= size <= 64 * 1024 * 1024 or not re.fullmatch(r"[a-f0-9]{64}", record["sha256"]):
            raise ValueError("Invalid Jai file metadata")
        expected[name] = record
    required = {"index.html", "worker.mjs", "jai_wasm.wasm"} if schema == 1 else {"jai_wasm.wasm", "jaifmt-playground.jai"}
    if not required <= expected.keys():
        raise ValueError("Missing Jai Wasm or bundle files")
    with zipfile.ZipFile(directory / "jai-playground.zip") as archive:
        members = archive.infolist()
        if len(members) != len(expected) or {i.filename for i in members} != expected.keys():
            raise ValueError("Jai archive inventory mismatch")
        if sum(i.file_size for i in members) > 128 * 1024 * 1024:
            raise ValueError("Jai expanded bundle exceeds limit")
        contents = {}
        for member in members:
            mode = member.external_attr >> 16
            if member.is_dir() or stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in (0, stat.S_IFREG) or member.flag_bits & 1:
                raise ValueError("Jai archive contains a non-regular or encrypted member")
            record = expected[member.filename]
            if member.file_size != record["size"]:
                raise ValueError("Jai member size mismatch")
            data = archive.read(member)
            if hashlib.sha256(data).hexdigest() != record["sha256"]:
                raise ValueError("Jai member checksum mismatch")
            if data.startswith((b"MZ", b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf")):
                raise ValueError("Native executable in Jai bundle")
            contents[member.filename] = data
        if not contents["jai_wasm.wasm"].startswith(b"\0asm\x01\0\0\0"):
            raise ValueError("Invalid Jai Wasm module")
    output = directory / "verified"
    output.mkdir()
    for name, data in contents.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f"Verified {len(contents)} Jai release members.")


if __name__ == "__main__":
    verify(Path(sys.argv[1]), sys.argv[2])
