"""An explicitly saved local library, separate from evictable playback cache."""
from pathlib import Path
import json
import re
import shutil
import threading
import time

from desktop_resource import MediaStore, ResourceError, DownloadPaused, atomic_json, read_json, digest


class OfflineLibrary:
    def __init__(self, server, data):
        self.server = server
        self.root = Path(data) / "offline-library"
        self.root.mkdir(parents=True, exist_ok=True)
        if self.root.is_symlink():
            raise ResourceError("Invalid offline directory")
        self.media = MediaStore(server, self.root)
        self.index = self.root / "library.json"
        self.guard = threading.RLock()
        self.cancel = {}
        self.active = False
        saved = read_json(self.index)
        self.items = saved.get("items", {})
        if (self.index.is_symlink() or not isinstance(self.items, dict)
                or (self.index.exists() and (saved.get("version") != 1 or "items" not in saved))):
            raise ResourceError("Invalid offline index")
        for sid, row in self.items.items():
            if (not re.fullmatch(r"\d{8,24}", sid) or not isinstance(row, dict)
                    or row.get("seriesId") != sid or not isinstance(row.get("episodes"), list)):
                raise ResourceError("Invalid offline index")
            for entry in row["episodes"]:
                if (not isinstance(entry, dict) or type(entry.get("episode")) is not int
                        or not re.fullmatch(r"\d{8,24}", str(entry.get("videoId", "")))
                        or entry.get("state") not in ("queued", "downloading", "paused", "complete", "failed")):
                    raise ResourceError("Invalid offline index")
                if entry["state"] in ("queued", "downloading"):
                    entry["state"] = "paused"
        self.save()

    def save(self):
        atomic_json(self.index, {"version": 1, "items": self.items})

    def listing(self):
        with self.guard:
            # Plain JSON snapshot, never signed addresses, paths, or keys.
            return {"items": json.loads(json.dumps(list(self.items.values())))}

    def enqueue(self, payload):
        sid = str(payload.get("seriesId", ""))
        episodes = payload.get("episodes", [])
        if (not re.fullmatch(r"\d{8,24}", sid) or not isinstance(episodes, list)
                or not 1 <= len(episodes) <= 50
                or any(type(n) is not int or not 1 <= n <= 100000 for n in episodes)):
            raise ResourceError("Select between 1 and 50 episodes")
        with self.guard:
            existing = self.items.get(sid)
        if existing:
            mapping = {e["episode"]: e["videoId"] for e in existing["episodes"]}
        else:
            mapping = {}
        if any(n not in mapping for n in episodes):
            meta, available = self.server.H.get_episodes(sid)
            mapping.update({e["index"]: str(e["vid"]) for e in available
                            if isinstance(e, dict) and type(e.get("index")) is int
                            and re.fullmatch(r"\d{8,24}", str(e.get("vid", "")))})
        if any(n not in mapping for n in episodes):
            raise ResourceError("Episode is not available")
        title = payload.get("title", "")
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200:
            raise ResourceError("Invalid series title")
        with self.guard:
            if len(self.items) >= 200 and sid not in self.items:
                raise ResourceError("Offline library is full")
            count = sum(len(r["episodes"]) for r in self.items.values())
            already = {e["episode"] for e in self.items.get(sid, {}).get("episodes", [])}
            if count + len(set(episodes) - already) > 1000:
                raise ResourceError("Offline library episode limit reached")
            row = self.items.setdefault(sid, {
                "seriesId": sid, "title": title.strip(),
                "episodeCount": max(mapping), "episodes": []})
            by_number = {e["episode"]: e for e in row["episodes"]}
            if len(by_number.keys() | set(episodes)) > 500:
                raise ResourceError("Offline series limit reached")
            for number in sorted(set(episodes)):
                entry = by_number.get(number)
                if entry and entry["state"] in ("complete", "downloading", "queued"):
                    continue
                if not entry:
                    entry = {"episode": number, "videoId": mapping[number]}
                    row["episodes"].append(entry)
                entry.update(state="queued", bytes=0, totalBytes=0, error="")
            row["episodes"].sort(key=lambda e: e["episode"])
            self.save()
            self.kick()
        return self.listing()

    def kick(self):
        if self.active:
            return
        self.active = True
        threading.Thread(target=self.worker, daemon=True).start()

    def worker(self):
        while True:
            with self.guard:
                pending = next(((row, e) for row in self.items.values() for e in row["episodes"]
                                if e["state"] == "queued"), None)
                if not pending:
                    self.active = False
                    return
                row, entry = pending
                key = (row["seriesId"], entry["episode"])
                event = self.cancel[key] = threading.Event()
                entry["state"] = "downloading"
                self.save()
            last_update = [0.0]
            def progress(done, total):
                with self.guard:
                    entry.update(bytes=done, totalBytes=total)
                    if time.monotonic() - last_update[0] > 2:
                        self.save()
                        last_update[0] = time.monotonic()
            try:
                # Do not auto-delete offline media to satisfy the temporary cache budget.
                if shutil.disk_usage(self.root).free < 1024 * 1024 * 1024:
                    raise ResourceError("Insufficient space")
                self.media.ensure(entry["videoId"], "desktop-resolution-v1",
                                  paused=event.is_set, progress=progress)
                with self.guard:
                    path = self.media.path(entry["videoId"], "desktop-resolution-v1")
                    entry.update(state="complete", bytes=path.stat().st_size,
                                 totalBytes=path.stat().st_size, error="")
            except DownloadPaused:
                with self.guard:
                    entry.update(state="paused", error="")
            except Exception:
                with self.guard:
                    entry.update(state="failed", error="保存未完成，请联网后重试。")
            finally:
                with self.guard:
                    self.cancel.pop(key, None)
                    self.save()

    def control(self, action, sid, episode):
        with self.guard:
            row = self.items.get(sid)
            entry = next((e for e in row["episodes"] if e["episode"] == episode), None) if row else None
            if not entry:
                raise ResourceError("Offline episode unavailable")
            event = self.cancel.get((sid, episode))
            if action == "pause":
                if event:
                    event.set()
                elif entry["state"] == "queued":
                    entry["state"] = "paused"
            elif action == "retry":
                if not event and entry["state"] != "complete":
                    entry.update(state="queued", error="")
                    self.kick()
            elif action == "remove":
                if event:
                    raise ResourceError("Pause and wait before removing")
                # Refuse deletion while any HLS job may hold a library source.
                if self.server._desktop_jobs.jobs:
                    raise ResourceError("Close the player before removing downloads")
                row["episodes"].remove(entry)
                if not row["episodes"]:
                    del self.items[sid]
                retained = any(e["videoId"] == entry["videoId"] for r in self.items.values() for e in r["episodes"])
                if not retained:
                    path = self.media.path(entry["videoId"], "desktop-resolution-v1")
                    for suffix in (".mp4", ".verified.json", ".transfer", ".transfer.part", ".transfer.part.json"):
                        target = path.with_suffix(suffix)
                        if target.parent != self.root or target.is_symlink():
                            raise ResourceError("Invalid local media path")
                        target.unlink(missing_ok=True)
            else:
                raise ResourceError("Unknown offline action")
            self.save()
        return self.listing()

    def source(self, sid, episode):
        # Strict local-only: never invokes episodes, video model, CDN, or refresh.
        with self.guard:
            row = self.items.get(sid, {})
            entry = next((e for e in row.get("episodes", []) if e["episode"] == episode), None)
            if not entry or entry["state"] != "complete":
                raise ResourceError("Episode has not been saved offline")
            path = self.media.path(entry["videoId"], "desktop-resolution-v1")
            if not self.media.valid(path):
                entry.update(state="failed", error="离线文件缺失或校验失败，请联网后重新保存。")
                self.save()
                raise ResourceError("Offline media is incomplete")
            return str(path)


def install(server, data):
    from fastapi import APIRouter, HTTPException, Request
    # Preserve the existing player/model/decryption/encoding choices.
    online = MediaStore(server, server.STREAM_CACHE)
    server._ensure_decrypted = online.ensure
    # Damaged offline metadata must not prevent the original online player
    # from starting, and must never be silently overwritten with an empty index.
    try:
        library = OfflineLibrary(server, data)
    except (ResourceError, OSError, ValueError, KeyError, TypeError):
        library = None
    if library is not None:
        server._desktop_jobs.offline_loader = library.source
    router = APIRouter(prefix="/desktop/offline")

    @router.post("")
    async def command(request: Request):
        try:
            if library is None:
                raise ResourceError("Offline index unavailable; existing files preserved")
            raw = await request.body()
            if len(raw) > 65536:
                raise ResourceError("Offline request too large")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ResourceError("Invalid offline request")
            action = payload.get("action")
            if action == "list":
                return library.listing()
            # Provider lookup/disk checks do not block the local API event loop.
            from starlette.concurrency import run_in_threadpool
            if action == "enqueue":
                return await run_in_threadpool(library.enqueue, payload)
            if action in ("pause", "retry", "remove"):
                return await run_in_threadpool(library.control, action,
                                               str(payload.get("seriesId", "")),
                                               payload.get("episode"))
            if action == "play":
                sid, ep = str(payload.get("seriesId", "")), payload.get("episode")
                await run_in_threadpool(library.source, sid, ep)
                row = library.items[sid]
                return {"seriesId": sid, "episode": ep, "title": row["title"],
                        "total": row["episodeCount"]}
            raise ResourceError("Unknown offline action")
        except (ResourceError, ValueError, KeyError, TypeError):
            raise HTTPException(409, "离线操作未完成，请检查分集状态；删除前请关闭播放器。") from None
        except Exception:
            raise HTTPException(503, "离线保存暂时无法连接资源，请稍后重试。") from None

    server.app.include_router(router)
    return library
