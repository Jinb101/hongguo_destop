"""从原版 exe 提取内嵌前端资源（WebView2 CDP -> Network.getResponseBody）。"""
import json, urllib.request, sys, os, time, base64
sys.path.insert(0, 'pydeps')
import websocket

OUT = sys.argv[1] if len(sys.argv) > 1 else 'app/frontend'
os.makedirs(OUT, exist_ok=True)

tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
page = [t for t in tabs if t.get("type") == "page"]
if not page:
    print("NO_PAGE"); sys.exit(1)
ws = websocket.create_connection(page[0]["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
i = [0]

def send(m, p=None):
    i[0] += 1
    ws.send(json.dumps({"id": i[0], "method": m, "params": p or {}}))
    return i[0]

def wait_id(my):
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == my:
            return msg.get("result", {})

send("Network.enable"); wait_id(i[0])
send("Page.enable"); wait_id(i[0])
urls = {}
wait_id(send("Page.navigate", {"url": "http://tauri.localhost/"}))
t0 = time.time()
while time.time() - t0 < 25:
    try:
        msg = json.loads(ws.recv())
    except Exception:
        break
    if msg.get("method") == "Network.responseReceived":
        p = msg["params"]
        urls[p["requestId"]] = (p["response"]["url"], p["response"].get("mimeType", ""))
    if msg.get("method") == "Network.loadingFinished":
        rid = msg["params"]["requestId"]
        if rid not in urls:
            continue
        url, mime = urls[rid]
        if not (url.endswith((".css", ".js", ".html")) or "text/html" in mime):
            continue
        r = wait_id(send("Network.getResponseBody", {"requestId": rid}))
        body = r.get("body", "")
        if r.get("base64Encoded"):
            body = base64.b64decode(body).decode("utf-8", "replace")
        name = url.split("/")[-1] or "index.html"
        if url.rstrip("/").endswith("tauri.localhost"):
            name = "index.html"
        open(os.path.join(OUT, name), "w", encoding="utf-8").write(body)
        print("SAVED", name, len(body))
