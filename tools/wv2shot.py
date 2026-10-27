import json, urllib.request, sys, os, time, base64, subprocess
sys.path.insert(0, 'pydeps')
import websocket

wv2 = r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\155.0.4283.62\msedgewebview2.exe"
profile = r"D:\IDEA\hongguo-destop\.wv2profile"
os.makedirs(profile, exist_ok=True)
os.makedirs('shots-new', exist_ok=True)

proc = subprocess.Popen([
    wv2, "--headless=new", "--disable-gpu", "--remote-debugging-port=9333",
    "--user-data-dir=" + profile, "--no-first-run", "--hide-scrollbars",
    "--window-size=1440,900", "--force-device-scale-factor=1",
    "http://127.0.0.1:4173/",
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

ws_url = None
for _ in range(60):
    try:
        tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json"))
        pages = [t for t in tabs if t.get("type") == "page" and "4173" in t.get("url", "")]
        if pages:
            ws_url = pages[0]["webSocketDebuggerUrl"]
            break
    except Exception:
        pass
    time.sleep(0.5)

if not ws_url:
    print("NO_CDP")
    proc.terminate()
    sys.exit(1)

ws = websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
i = [0]


def call(m, p=None):
    i[0] += 1
    ws.send(json.dumps({"id": i[0], "method": m, "params": p or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == i[0]:
            return msg.get("result", {})


def ev(e):
    return call("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": True}).get("result", {}).get("value")


def shot(name):
    r = call("Page.captureScreenshot", {"format": "png"})
    b = r.get("data")
    if b:
        open(f"shots-new/{name}.png", "wb").write(base64.b64decode(b))
        print("shot", name)


call("Page.enable")
call("Runtime.enable")
time.sleep(6)

shot("01-home")

ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('更多'))?.click()")
time.sleep(0.6)
ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('排行榜'))?.click()")
time.sleep(4)
shot("02-rank")

ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('我的'))?.click()")
time.sleep(1.5)
shot("03-mine")

ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('搜索'))?.click()")
time.sleep(1)
shot("04-search")

ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('首页'))?.click()")
time.sleep(3)
ev("document.querySelector('.cover')?.click()")
time.sleep(3)
shot("05-detail")

stats = ev("""JSON.stringify({
  dom: document.querySelectorAll('*').length,
  imgs: document.querySelectorAll('img').length,
  lazyImgs: [...document.querySelectorAll('img')].filter(i=>i.getAttribute('loading')==='lazy').length,
  eagerImgs: [...document.querySelectorAll('img')].filter(i=>i.getAttribute('loading')==='eager').length,
  cards: document.querySelectorAll('.card').length,
  imagesWithSrc: [...document.querySelectorAll('img')].filter(i=>i.getAttribute('src')).length,
  heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null,
  scrollH: document.documentElement.scrollHeight,
  bodyText: document.body.innerText.slice(0,150)
})""")
print("STATS", stats)

proc.terminate()
