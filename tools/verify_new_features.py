"""验证小窗播放 / 推荐滑动 / 上下切换三个新功能。"""
import json, urllib.request, sys, os, time, base64
sys.path.insert(0, 'pydeps')
import websocket

os.makedirs('shots-new', exist_ok=True)
tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
page = [t for t in tabs if t.get("type") == "page"]
if not page:
    print("NO_PAGE"); sys.exit(1)
ws = websocket.create_connection(page[0]["webSocketDebuggerUrl"], timeout=90, suppress_origin=True)
i = [0]

def call(m, p=None):
    i[0] += 1
    ws.send(json.dumps({"id": i[0], "method": m, "params": p or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == i[0]:
            return msg.get("result", {})

def ev(e):
    r = call("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": True})
    if "exceptionDetails" in r:
        return "EXC: " + str(r["exceptionDetails"].get("text"))[:200]
    return r.get("result", {}).get("value")

def shot(name):
    r = call("Page.captureScreenshot", {"format": "png"})
    b = r.get("data")
    if b:
        open(f"shots-new/{name}.png", "wb").write(base64.b64decode(b))
        print("shot", name)

call("Page.enable"); call("Runtime.enable")
ev("location.replace('http://127.0.0.1:4173/?t='+Date.now())")
time.sleep(10)

# 打开第一个剧目的详情
print("open detail:", ev("(()=>{const c=document.querySelector('.card .cover'); if(!c) return 'no-cover'; c.click(); return 'clicked'})()"))
time.sleep(4)
shot("06-detail-sheet")

# 点击立即播放
time.sleep(1)
print("play:", ev("(()=>{const b=[...document.querySelectorAll('.sheet button')].find(e=>e.textContent.includes('立即播放')); if(!b) return 'no-btn:'+document.querySelectorAll('.sheet').length; b.click(); return 'ok'})()"))
time.sleep(9)
shot("07-player")

print("PLAYER STATE:", ev("""JSON.stringify({
  hasVideo: !!document.querySelector('video'),
  videoSrc: (document.querySelector('video')?.src||'').slice(0,90),
  videoReady: document.querySelector('video')?.readyState,
  videoW: document.querySelector('video')?.videoWidth,
  epRows: document.querySelectorAll('.ep-row').length,
  swipeItems: document.querySelectorAll('.swipe-item').length,
  swipeActive: document.querySelector('.swipe-item.is-active')?.querySelector('.swipe-caption-title')?.textContent,
  text: document.body.innerText.slice(0,120)
})"""))

# 收起小窗
print("minimize:", ev("(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('收起小窗')); if(!b) return 'no-btn'; b.click(); return 'ok'})()"))
time.sleep(3)
shot("08-miniplayer")

print("MINI STATE:", ev("""JSON.stringify({
  miniExists: !!document.querySelector('.miniplayer'),
  miniVideo: !!document.querySelector('.miniplayer video'),
  miniSrc: (document.querySelector('.miniplayer video')?.src||'').slice(0,90),
  mainNavVisible: !!document.querySelector('.rail'),
  bodyText: document.body.innerText.slice(0,100)
})"""))

# 在主界面继续浏览（模拟小窗播放时找剧）
print("nav to rank:", ev("(()=>{const b=[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('更多')); b?.click(); return 'ok'})()"))
time.sleep(1)
ev("(()=>{const b=[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('排行榜')); b?.click(); return 'ok'})()")
time.sleep(6)
shot("09-browse-while-playing")

print("BROWSE STATE:", ev("""JSON.stringify({
  miniStillThere: !!document.querySelector('.miniplayer'),
  miniVideoPaused: document.querySelector('.miniplayer video')?.paused,
  miniTime: document.querySelector('.miniplayer video')?.currentTime,
  cards: document.querySelectorAll('.card').length
})"""))

# 上下滑动推荐：回到播放页
print("expand:", ev("(()=>{const b=[...document.querySelectorAll('.miniplayer-btn')].find(e=>e.textContent.includes('⤢')); if(!b) return 'no-btn'; b.click(); return 'ok'})()"))
time.sleep(3)
shot("10-player-swipe")

print("SWIPE:", ev("""JSON.stringify({
  swipeItems: document.querySelectorAll('.swipe-item').length,
  activeTitle: document.querySelector('.swipe-item.is-active .swipe-caption-title')?.textContent,
  listH: document.querySelector('.swipe-list')?.clientHeight
})"""))
