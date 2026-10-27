import sys, json, urllib.request, time, base64
sys.path.insert(0, 'pydeps')
import websocket

port = sys.argv[1] if len(sys.argv) > 1 else '9222'
tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
page = [t for t in tabs if t.get("type") == "page"][0]
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=90, suppress_origin=True)
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
        return "EXC " + str(r["exceptionDetails"].get("text"))[:300]
    return r.get("result", {}).get("value")


call("Page.enable")
call("Runtime.enable")
time.sleep(3)

# 确保是「未收藏」状态
ev("""(()=>{const b=document.querySelector('.card-fav'); return b.className.includes('is-on')?'on':'off'})()""")
state = ev("document.querySelector('.card-fav').className.includes('is-on')")
if state:
    ev("document.querySelector('.card-fav').click()")
    time.sleep(2)
    ev("location.reload()")
    time.sleep(9)

print("初始状态:", ev("document.querySelector('.card-fav').className.includes('is-on') ? '已收藏' : '未收藏'"))

# 收藏
ev("document.querySelector('.card-fav').click()")
time.sleep(0.6)
print("点击后 toast:", ev("document.querySelector('.toast')?.textContent || '(none)'"))
time.sleep(2)
print("点击后状态:", ev("document.querySelector('.card-fav').className.includes('is-on') ? '已收藏' : '未收藏'"))

# 收藏页
ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('收藏'))?.click()")
time.sleep(3)
print()
print("收藏页卡片数:", ev("document.querySelectorAll('.card').length"))
print("收藏页标题:", ev("""JSON.stringify([...document.querySelectorAll('.card-title')].map(t=>t.textContent).slice(0,5))"""))
print("收藏页封面:", ev("""JSON.stringify([...document.querySelectorAll('.card img')].slice(0,2).map(i=>({w:i.naturalWidth,len:(i.getAttribute('src')||'').length})))"""))

r = call("Page.captureScreenshot", {"format": "png"})
open("shots-new/18-favorites-page.png", "wb").write(base64.b64decode(r.get("data")))
print("shot 18-favorites-page")
