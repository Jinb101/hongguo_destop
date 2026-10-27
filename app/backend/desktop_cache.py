"""Bound old completed playback cache at managed startup, before any readers.

Only the single-instance desktop bootstrap calls this. It is not a background
janitor or a hard live-session quota. Recent files, partial downloads, unknown
files, links and user databases are deliberately outside the deletion set.
"""
from pathlib import Path
import re
import stat
import time

DEFAULT_LIMIT = 2 * 1024 ** 3
MIN_AGE_SECONDS = 24 * 60 * 60
_NAME = re.compile(r"[0-9]{8,24}_[A-Za-z0-9_]{1,64}(?:\.raw)?\.mp4\Z", re.ASCII)


def _linked(info):
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def prune_stream_cache(data, *, limit=DEFAULT_LIMIT, now=None, max_seconds=1.0):
    """Best-effort oldest-first eviction. Return numeric counts, never paths."""
    if type(limit) is not int or limit < 0:
        raise ValueError("Invalid cache budget")
    data = Path(data)
    deadline = time.monotonic() + max_seconds
    result = {"before_bytes": 0, "after_bytes": 0, "removed_files": 0, "removed_bytes": 0,
              "skipped_files": 0, "errors": 0}
    root = data / "stream-cache"
    try:
        if not data.is_absolute() or _linked(data.lstat()) or _linked(root.lstat()) or not root.is_dir():
            return result
        # Do not follow a redirected ancestor into an unexpected location.
        if any(_linked(parent.lstat()) for parent in data.parents):
            return result
        rows = []
        for path in root.iterdir():
            if time.monotonic() >= deadline or len(rows) >= 10000:
                break
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or _linked(info) or info.st_nlink != 1 or not _NAME.fullmatch(path.name):
                result["skipped_files"] += 1
                continue
            rows.append((info.st_mtime, path.name, path, info))
            result["before_bytes"] += info.st_size
        result["after_bytes"] = result["before_bytes"]
        cutoff = (time.time() if now is None else now) - MIN_AGE_SECONDS
        for modified, _, path, before in sorted(rows):
            if result["after_bytes"] <= limit or time.monotonic() >= deadline:
                break
            if modified > cutoff:
                continue
            try:
                current = path.lstat()
                if (_linked(current) or current.st_nlink != 1 or not stat.S_ISREG(current.st_mode)
                        or (current.st_ino, current.st_size, current.st_mtime_ns)
                        != (before.st_ino, before.st_size, before.st_mtime_ns)):
                    result["skipped_files"] += 1
                    continue
                path.unlink()
                result["removed_files"] += 1
                result["removed_bytes"] += before.st_size
                result["after_bytes"] -= before.st_size
            except OSError:
                result["errors"] += 1  # Locked or changed cache must not prevent startup.
    except FileNotFoundError:
        pass
    except OSError:
        result["errors"] += 1
    return result
