"""Bounded recovery for the existing desktop media path; no new media provider."""
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time


class ResourceError(ValueError):
    pass


class DownloadPaused(ResourceError):
    pass


def digest(path):
    with Path(path).open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf8") as f:
        json.dump(value, f, ensure_ascii=False, separators=(",", ":"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json(path):
    try:
        if Path(path).stat().st_size > 1024 * 1024:
            return {}
        return json.loads(Path(path).read_text(encoding="utf8"))
    except (OSError, ValueError):
        return {}


def check_path(path):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ResourceError("Invalid local media path")


def validate_media(path):
    """Container plus first/last decodable frames; receipts detect later changes."""
    import av
    with av.open(str(path)) as media:
        if not media.streams.video or not media.duration or media.duration <= 0:
            raise ResourceError("Incomplete media")
        video = media.streams.video[0]
        if next(media.decode(video), None) is None:
            raise ResourceError("Missing video frames")
        duration = media.duration / av.time_base
        if duration > 86400:
            raise ResourceError("Unsupported media duration")
        if duration > 3:
            media.seek(int((duration - 2) / float(video.time_base)), stream=video,
                       backward=True, any_frame=False)
            if next(media.decode(video), None) is None:
                raise ResourceError("Missing final frames")


def download(resolve, request, destination, *, identity, paused=lambda: False,
             progress=lambda done, total: None, sleep=time.sleep, attempts=4):
    """Resume only the same representation with a strong validator.

    Signed addresses are memory-only. One stale CDN address may be refreshed;
    account rejection/rate limiting is not a reason to rotate or retry identities.
    """
    destination = Path(destination)
    partial = destination.with_suffix(destination.suffix + ".part")
    sidecar = partial.with_suffix(partial.suffix + ".json")
    for path in (destination, partial, sidecar):
        check_path(path)
    refreshed = False
    track = resolve()
    for attempt in range(attempts):
        if paused():
            raise DownloadPaused("Download paused")
        # Key hashes bind encrypted bytes to their representation without saving keys.
        representation = hashlib.sha256(json.dumps(
            [identity, track.get("size", 0), bool(track.get("encrypt")),
             track.get("spade_a", ""), track.get("definition", "")],
            separators=(",", ":")).encode()).hexdigest()
        saved = read_json(sidecar)
        offset = partial.stat().st_size if partial.exists() else 0
        validator = saved.get("etag", "")
        if (saved.get("representation") != representation or not isinstance(validator, str)
                or not validator.startswith('"') or not validator.endswith('"')
                or saved.get("total", 0) < offset):
            offset = 0
        headers = {"Accept-Encoding": "identity"}
        if offset:
            headers.update(Range=f"bytes={offset}-", **{"If-Range": validator})
        response = None
        try:
            response = request("GET", track["url"], headers=headers, stream=True, timeout=30)
            status = response.status_code
            if status == 416 and offset:
                # A stale/misaligned partial must not cause an endless 416 loop.
                atomic_json(sidecar, {})
                continue
            if status in (403, 404, 410):
                response.close()
                response = None
                if refreshed:
                    raise ResourceError("Media address unavailable")
                refreshed = True
                new_track = resolve()
                if new_track.get("url") == track.get("url"):
                    raise ResourceError("Media address was not renewed")
                track = new_track
                continue
            if status not in (200, 206):
                raise ResourceError("Media request rejected")
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise ResourceError("Unsupported media encoding")
            if status == 206:
                match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)",
                                    response.headers.get("Content-Range", ""))
                if (not offset or not match or int(match[1]) != offset
                        or int(match[2]) != int(match[3]) - 1
                        or response.headers.get("ETag") != validator
                        or int(match[3]) != saved.get("total")):
                    raise ResourceError("Invalid resumed media range")
                total = int(match[3])
                length = int(response.headers.get("Content-Length", total - offset))
                if length != total - offset:
                    raise ResourceError("Invalid resumed media length")
            else:
                offset = 0  # Server ignored Range or If-Range: replace, never append.
                total = int(response.headers.get("Content-Length") or track.get("size") or 0)
            if not 0 <= total <= 1024 * 1024 * 1024:
                raise ResourceError("Oversized media")
            expected = int(track.get("size") or 0)
            if expected and total != expected:
                raise ResourceError("Media size differs from metadata")
            etag = response.headers.get("ETag", "")
            atomic_json(sidecar, {"representation": representation, "etag": etag,
                                  "total": total})
            done = offset
            with partial.open("ab" if offset else "wb") as output:
                for chunk in response.iter_content(262144):
                    if paused():
                        raise DownloadPaused("Download paused")
                    if not chunk:
                        continue
                    done += len(chunk)
                    if done > 1024 * 1024 * 1024 or (total and done > total):
                        raise ResourceError("Media exceeds declared size")
                    output.write(chunk)
                    progress(done, total)
                output.flush()
                os.fsync(output.fileno())
            if not done or (total and done != total):
                raise OSError("Media transfer incomplete")
            os.replace(partial, destination)
            sidecar.unlink(missing_ok=True)
            return track
        except (ResourceError, ValueError, KeyError, TypeError):
            raise
        except Exception as error:
            # Only transport exceptions are retryable. Other failures retain a
            # partial file for an explicit retry but do not loop indefinitely.
            import requests
            if not isinstance(error, (OSError, requests.RequestException)) or attempt + 1 == attempts:
                raise ResourceError("Media transfer interrupted") from None
            if paused():
                raise DownloadPaused("Download paused") from None
            sleep(min(attempt + 1, 3))
        finally:
            if response is not None:
                response.close()
    raise ResourceError("Media recovery limit reached")


class MediaStore:
    def __init__(self, server, root, validator=validate_media):
        self.server, self.root, self.validator = server, Path(root), validator
        self.root.mkdir(parents=True, exist_ok=True)
        self.guard, self.locks = threading.Lock(), {}

    def lock(self, key):
        with self.guard:
            return self.locks.setdefault(key, threading.RLock())

    def path(self, video, quality):
        if not re.fullmatch(r"\d{8,24}", str(video)) or not re.fullmatch(r"[\w-]{1,64}", quality):
            raise ResourceError("Invalid media identity")
        return self.root / f"{video}_{quality}.mp4"

    def valid(self, path, *, adopt=False):
        receipt = path.with_suffix(".verified.json")
        for p in (path, receipt):
            check_path(p)
        if not path.exists() or path.stat().st_size <= 0:
            return False
        saved = read_json(receipt)
        if saved.get("bytes") == path.stat().st_size and saved.get("sha256") == digest(path):
            return True
        if saved or not adopt:
            return False
        try:
            self.validator(path)
        except Exception:
            return False
        self.seal(path)
        return True

    def seal(self, path):
        atomic_json(path.with_suffix(".verified.json"),
                    {"bytes": path.stat().st_size, "sha256": digest(path)})

    def ensure(self, video, quality="best", *, paused=lambda: False,
               progress=lambda done, total: None):
        out = self.path(video, quality)
        with self.lock(out.name):
            if self.valid(out, adopt=True):
                return str(out)
            # Only files named by this validated media ID in the owned cache.
            # No database, offline library, or unrelated source is touched.
            out.unlink(missing_ok=True)
            out.with_suffix(".verified.json").unlink(missing_ok=True)
            transfer = out.with_suffix(".transfer")
            def resolve():
                value = self.server._vm_track(str(video), quality)
                if not value or not value.get("url"):
                    raise ResourceError("Episode media unavailable")
                return value
            track = download(resolve, self.server.H.http_request, transfer,
                             identity=f"{video}:{quality}", paused=paused, progress=progress)
            try:
                if paused():
                    raise DownloadPaused("Download paused")
                if track.get("encrypt"):
                    result = self.server.OD.offline_decrypt(track["spade_a"], str(transfer), str(out))
                    if not result:
                        raise ResourceError("Media preparation failed")
                    if Path(result).resolve() != out.resolve():
                        from desktop_remux import remux
                        remux(result, str(out))
                        raw = out.with_suffix(".raw.mp4")
                        if Path(result).resolve() == raw.resolve():
                            raw.unlink(missing_ok=True)
                else:
                    os.replace(transfer, out)
                self.validator(out)
                self.seal(out)
                return str(out)
            except Exception:
                out.unlink(missing_ok=True)
                raise
            finally:
                transfer.unlink(missing_ok=True)
