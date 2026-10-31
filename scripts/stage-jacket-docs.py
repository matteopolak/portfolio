#!/usr/bin/env python3
"""Checks a jacket-docs tarball and stages it as the /docs/jacket site.

    stage-jacket-docs.py <tarball> <revision> [--sha256 <hex>] [--out <dir>]

The tarball (attached to each Jacket release from 0.31.0) holds the site at its
top level, built with `--base-url /docs/jacket/`. It may only hold regular
files and directories with plain relative paths, within the limits below, and
must have index.html. With --out, the site is extracted there (replacing it),
without its own copy of the browser compiler (`runtime/`): runtime.json points
at the playground's copy under /jai/<revision>/ instead.
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

MAX_FILES = 12_000
MAX_FILE = 25 * 1024 * 1024  # Cloudflare Pages' per-file limit.
MAX_TOTAL = 256 * 1024 * 1024


def members(archive):
    files = []
    total = 0
    seen = set()
    for member in archive.getmembers():
        name = member.name.removeprefix("./")
        if member.isdir() and name in ("", "."):
            continue
        parts = PurePosixPath(name).parts
        if (not name or name.startswith("/") or "\\" in name or "\x00" in name or ":" in name
                or str(PurePosixPath(name)) != name.rstrip("/")
                or any(part in ("", ".", "..") for part in parts)):
            raise ValueError(f"Unsafe path in the docs: {member.name!r}")
        if member.isdir():
            continue
        if not member.isfile():
            raise ValueError(f"Not a regular file in the docs: {name!r}")
        if name in seen:
            raise ValueError(f"Duplicate file in the docs: {name!r}")
        seen.add(name)
        if member.size > MAX_FILE:
            raise ValueError(f"Docs file over 25 MiB: {name!r}")
        total += member.size
        files.append((name, member))
    if len(files) > MAX_FILES or total > MAX_TOTAL:
        raise ValueError(f"Docs too large: {len(files)} files, {total} bytes")
    if "index.html" not in seen:
        raise ValueError("The docs have no index.html")
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("tarball", type=Path)
    parser.add_argument("revision")
    parser.add_argument("--sha256")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.revision):
        raise ValueError("Invalid revision")
    data = args.tarball.read_bytes()
    if args.sha256 is not None and hashlib.sha256(data).hexdigest() != args.sha256:
        raise ValueError("Docs checksum mismatch")
    with tarfile.open(args.tarball, "r:gz") as archive:
        files = members(archive)
        if args.out is None:
            print(f"Checked {len(files)} docs files.")
            return
        staging = args.out.with_name(args.out.name + ".staging")
        shutil.rmtree(staging, ignore_errors=True)
        kept = 0
        for name, member in files:
            # The playground already serves this compiler; the pages read runtime.json.
            if name.startswith("runtime/") or name == "runtime.json":
                continue
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            with source, open(target, "wb") as out:
                shutil.copyfileobj(source, out)
            kept += 1
    base = f"/jai/{args.revision}/"
    (staging / "runtime.json").write_text(
        json.dumps({"engine": base + "engine.mjs", "wasm": base + "jai_wasm.wasm"}) + "\n")
    shutil.rmtree(args.out, ignore_errors=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    staging.rename(args.out)
    print(f"Staged {kept} docs files in {args.out}.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, tarfile.TarError) as error:
        print(f"jacket docs: {error}", file=sys.stderr)
        sys.exit(1)
