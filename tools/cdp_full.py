import json, urllib.request, sys, os, time, base64
sys.path.insert(0,'pydeps')
import websocket
os.makedirs('shots-new', exist_ok=True)
tabs=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
ws_url=[t for t in tabs if t.get("type")=="page"][0]["webSocketDebuggerUrl"]
ws=websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
i=[0]
def call(m,p=None):
    i[0]+=1; ws.send(json.dumps({"id":i[0],"method":m,"params":p or {}}))
    while True:
        msg=json.loads(ws.recv())
        if msg.get("id")==i[0]: return msg.get("result",{})
def ev(e):
    return call("Runtime.evaluate",{"expression":e,"returnByValue":True,"awaitPromise":True}).get("result",{}).get("value")
def shot(name):
    r=call("Page.captureScreenshot",{"format":"png"})
    b=r.get("data")
    if b:
        open(f"shots-new/{name}.png","wb").write(base64.b64decode(b)); print("shot",name)
def nav(label):
    ev(f"[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('{label}'))?.click()")
call("Page.enable"); call("Runtime.enable")
ev("location.href='http://127.0.0.1:4173/'")
time.sleep(9)
shot("01-home")

# 更多 -> 排行榜
nav("更多"); time.sleep(0.8)
nav("排行榜"); time.sleep(6); shot("02-rank")

# 我的
nav("我的"); time.sleep(2); shot("03-mine")

# 搜索
nav("搜索"); time.sleep(2); shot("04-search")

# 回首页 -> 打开详情抽屉
nav("首页"); time.sleep(5)
ev("document.querySelector('.cover')?.click()")
time.sleep(3); shot("05-detail")

# 性能对比
print("STATS", ev("""JSON.stringify({
 dom: document.querySelectorAll('*').length,
 imgs: document.querySelectorAll('img').length,
 lazy: [...document.querySelectorAll('img')].filter(i=>i.getAttribute('loading')==='lazy').length,
 eager: [...document.querySelectorAll('img')].filter(i=>i.getAttribute('loading')==='eager').length,
 cards: document.querySelectorAll('.card').length,
 withSrc: [...document.querySelectorAll('img')].filter(i=>i.getAttribute('src')).length,
 heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null,
 scrollH: document.documentElement.scrollHeight
})"""))
