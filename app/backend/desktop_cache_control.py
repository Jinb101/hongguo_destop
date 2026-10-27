"""User cache controls; deletion remains exclusively in startup's existing pruner.

The CLI only inspects or queues a request. It never deletes playback files.
No credentials, provider requests, history or account database are read here.
"""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from desktop_cache import DEFAULT_LIMIT, MIN_AGE_SECONDS, _NAME, _linked, prune_stream_cache

POLICY = "cache-policy-v1.json"
REQUEST = "cache-clear-request-v1.json"
RECEIPT = "cache-clear-result-v1.json"
BUDGETS = (1, 2, 5, 10)
GIB = 1024 ** 3


def safe_data(data):
    data = Path(data)
    if not data.is_absolute():
        raise ValueError("Cache data directory must be absolute")
    for path in [data, *data.parents]:
        info = path.lstat()
        if _linked(info) or not stat.S_ISDIR(info.st_mode):
            raise ValueError("Redirected data directory")
    return data


def regular(path, missing=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        if missing:
            return None
        raise
    if _linked(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("Unexpected control file")
    return info


def read_json(data, name, default):
    path = data / name
    info = regular(path, missing=True)
    if info is None:
        return default
    if info.st_size > 4096:
        raise ValueError("Oversized cache control")
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_ino, opened.st_dev) != (info.st_ino, info.st_dev):
            raise ValueError("Changed cache control")
        value = json.loads(stream.read(4097))
    if not isinstance(value, dict) or value.get("schema") != 1:
        raise ValueError("Invalid cache control")
    return value


def write_json(data, name, value):
    target = data / name
    regular(target, missing=True)
    fd, temporary = tempfile.mkstemp(prefix=".cache-control-", dir=data)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        regular(target, missing=True)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def exclusive(data):
    path = data / "cache-control.lock"
    regular(path, missing=True)
    with path.open("a+b") as stream:
        info = os.fstat(stream.fileno())
        if info.st_nlink != 1 or not stat.S_ISREG(info.st_mode):
            raise ValueError("Unexpected cache lock")
        if info.st_size == 0:
            stream.write(b"0"); stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def policy(data):
    value = read_json(data, POLICY, {"schema": 1, "limitGiB": DEFAULT_LIMIT // GIB})
    limit = value.get("limitGiB")
    if type(limit) is not int or limit not in BUDGETS:
        raise ValueError("Invalid cache budget")
    return limit


def request(data):
    value = read_json(data, REQUEST, None)
    if value is not None:
        ident = value.get("id")
        if not isinstance(ident, str) or len(ident) != 32 or any(c not in "0123456789abcdef" for c in ident):
            raise ValueError("Invalid request id")
    return value


def scan(data, *, now=None, max_seconds=.25, max_entries=10000):
    result = dict(bytes=0, eligibleBytes=0, files=0, skipped=0, errors=0, partial=False)
    root = data / "stream-cache"
    deadline = time.monotonic() + max_seconds
    cutoff = (time.time() if now is None else now) - MIN_AGE_SECONDS
    try:
        info = root.lstat()
        if _linked(info) or not stat.S_ISDIR(info.st_mode):
            result.update(errors=1, partial=True)
            return result
        with os.scandir(root) as entries:
            for index, entry in enumerate(entries):
                if time.monotonic() >= deadline or index >= max_entries:
                    result["partial"] = True
                    break
                try:
                    # Windows DirEntry.stat can omit link counts; match the
                    # existing pruner's lstat before reporting eligibility.
                    info = Path(entry.path).lstat()
                    if _linked(info) or not stat.S_ISREG(info.st_mode):
                        result["skipped"] += 1
                        continue
                    result["bytes"] += info.st_size
                    result["files"] += 1
                    if info.st_nlink == 1 and _NAME.fullmatch(entry.name) and info.st_mtime <= cutoff:
                        result["eligibleBytes"] += info.st_size
                except OSError:
                    result["errors"] += 1
                    result["partial"] = True
    except FileNotFoundError:
        pass
    except OSError:
        result.update(errors=1, partial=True)
    return result


def report(data):
    data = safe_data(data)
    last = read_json(data, RECEIPT, None)
    if last is not None:
        # Only numeric summaries cross to the UI; never arbitrary stored text.
        fields = ("removedBytes", "removedFiles", "errors", "remainingEligibleBytes", "finishedAt")
        if any(type(last.get(k)) is not int or last[k] < 0 for k in fields) or type(last.get("partial")) is not bool:
            raise ValueError("Invalid cache receipt")
        last = {k: last[k] for k in (*fields, "partial")}
    return dict(supported=True, directory=str(data / "stream-cache"), limitGiB=policy(data),
                pending=request(data) is not None, lastResult=last, **scan(data))


def manage(data, action, limit=None):
    data = safe_data(data)
    if action == "status":
        return report(data)
    if action not in ("budget", "schedule", "cancel"):
        raise ValueError("Invalid cache action")
    with exclusive(data):
        if action == "budget":
            if type(limit) is not int or limit not in BUDGETS:
                raise ValueError("Invalid cache budget")
            write_json(data, POLICY, dict(schema=1, limitGiB=limit))
        elif action == "schedule":
            # Duplicate clicks retain the same request identity.
            if request(data) is None:
                write_json(data, REQUEST, dict(schema=1, id=uuid.uuid4().hex))
        else:
            if request(data) is not None:
                (data / REQUEST).unlink()
        return report(data)


def maintain_at_startup(data, *, now=None):
    """Called before provider/encoder readers. Failures must not prevent startup."""
    try:
        data = safe_data(data)
        with exclusive(data):
            pending = request(data)
            limit = policy(data)
            if pending:
                previous = read_json(data, RECEIPT, None)
                if previous and previous.get("id") == pending["id"]:
                    (data / REQUEST).unlink()
                    return  # A crash after receipt persistence must not replay.
                result = prune_stream_cache(data, limit=0, now=now)
                remaining = scan(data, now=now)
                receipt = dict(schema=1, id=pending["id"], removedBytes=result["removed_bytes"],
                               removedFiles=result["removed_files"], errors=result["errors"] + remaining["errors"],
                               remainingEligibleBytes=remaining["eligibleBytes"], partial=remaining["partial"],
                               finishedAt=int(time.time() if now is None else now))
                write_json(data, RECEIPT, receipt)
                (data / REQUEST).unlink()
            else:
                prune_stream_cache(data, limit=limit * GIB, now=now)
    except (OSError, ValueError, TypeError):
        # Leave an unconsumed request in place. UI inspection reports invalid
        # settings; do not silently delete under a different policy.
        return


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--action", choices=("status", "budget", "schedule", "cancel"), required=True)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    try:
        print(json.dumps(manage(Path(args.data), args.action, args.limit), ensure_ascii=True))
    except (OSError, ValueError, TypeError):
        print('{"error":"cache_control_unavailable"}')
        sys.exit(1)
