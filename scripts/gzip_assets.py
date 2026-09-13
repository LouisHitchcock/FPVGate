"""Pre-compress the web assets into the LittleFS image at build time.

A cold load of the UI is about 788 KB of text - script.js alone is 382 KB - and
all of it was being served raw. Gzip takes that to roughly a quarter, which
matters for two reasons: the transfer finishes sooner, so concurrent requests
overlap less, and the filesystem partition stops being tight.

`data/` stays the source of truth, uncompressed and diffable. This script stages
a compressed copy into the build directory and points PlatformIO's filesystem
builder at that instead, so nothing in the working tree changes and there is no
"did you remember to re-gzip" failure mode.

ESPAsyncWebServer's AsyncStaticWebHandler::_searchFile tries `<path>` first and
falls back to `<path>.gz`, setting Content-Encoding: gzip. It does NOT check the
request's Accept-Encoding header, so a client that cannot handle gzip will still
be sent gzip. That is why only one form of each file is staged: shipping both
would double the space and the plain file would always win, defeating the point.

Wired up as `extra_scripts = pre:scripts/gzip_assets.py`.
"""

import gzip
import os
import shutil

Import("env")  # noqa: F821  - injected by PlatformIO

# Text formats worth compressing. Anything already compressed (png, jpg, woff2,
# mp3) is copied through untouched; re-compressing it wastes build time and
# usually makes the file slightly larger.
COMPRESSIBLE = {".html", ".htm", ".css", ".js", ".json", ".svg", ".txt", ".xml", ".map"}

# Below this, the ~20 byte gzip header and the extra directory entry cost more
# than the saving is worth, and LittleFS allocates by block anyway.
MIN_BYTES = 1024


def stage_assets(source, target):
    if os.path.isdir(target):
        shutil.rmtree(target)

    raw_total = 0
    staged_total = 0
    compressed_files = 0
    copied_files = 0

    for root, _dirs, files in os.walk(source):
        relative = os.path.relpath(root, source)
        destination = target if relative == "." else os.path.join(target, relative)
        os.makedirs(destination, exist_ok=True)

        for name in files:
            source_path = os.path.join(root, name)
            size = os.path.getsize(source_path)
            raw_total += size
            extension = os.path.splitext(name)[1].lower()

            if extension not in COMPRESSIBLE or size < MIN_BYTES:
                shutil.copy2(source_path, os.path.join(destination, name))
                staged_total += size
                copied_files += 1
                continue

            with open(source_path, "rb") as handle:
                payload = handle.read()
            # mtime=0 keeps the output byte-identical between builds, so an
            # unchanged asset does not produce a different filesystem image.
            compressed = gzip.compress(payload, compresslevel=9, mtime=0)

            # If compression does not actually help, ship the original. A file
            # that grows would otherwise cost space and still force the gzip
            # path on every client.
            if len(compressed) >= size:
                shutil.copy2(source_path, os.path.join(destination, name))
                staged_total += size
                copied_files += 1
                continue

            with open(os.path.join(destination, name + ".gz"), "wb") as handle:
                handle.write(compressed)
            staged_total += len(compressed)
            compressed_files += 1

    return raw_total, staged_total, compressed_files, copied_files


source_dir = env.subst("$PROJECT_DATA_DIR")  # noqa: F821
staged_dir = os.path.join(env.subst("$BUILD_DIR"), "data_gz")  # noqa: F821

if os.path.isdir(source_dir):
    raw, staged, compressed_count, copied_count = stage_assets(source_dir, staged_dir)
    saved = raw - staged
    percent = (saved / raw * 100) if raw else 0
    print(f"gzip_assets: {compressed_count} compressed, {copied_count} copied as-is")
    print(f"gzip_assets: {raw / 1024:.0f} KB -> {staged / 1024:.0f} KB "
          f"(saved {saved / 1024:.0f} KB, {percent:.0f}%)")
    env.Replace(PROJECT_DATA_DIR=staged_dir)  # noqa: F821
else:
    print(f"gzip_assets: no data directory at {source_dir}, nothing to stage")
