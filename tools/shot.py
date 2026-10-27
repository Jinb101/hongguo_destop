import json, urllib.request, sys, time, base64, os
sys.path.insert(0,'pydeps')
import websocket
os.makedirs('shots',exist_ok=True)
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
        open(f'shots/{name}.png','wb').write(base64.b64decode(b))
        print("shot",name)
call("Page.enable")
# current view
shot("01-discover")
# click 排行榜
ev("[...document.querySelectorAll('.main-nav *')].find(e=>e.textContent.trim()==='排行榜')?.click()")
time.sleep(3); shot("02-rank")
# 探索
ev("[...document.querySelectorAll('.main-nav *')].find(e=>e.textContent.trim()==='探索')?.click()")
time.sleep(3); shot("03-explore")
# 收藏
ev("[...document.querySelectorAll('.main-nav *')].find(e=>e.textContent.trim()==='收藏')?.click()")
time.sleep(2); shot("04-fav")
# 历史
ev("[...document.querySelectorAll('.main-nav *')].find(e=>e.textContent.trim().startsWith('历史'))?.click()")
time.sleep(2); shot("05-history")
# 设置
ev("[...document.querySelectorAll('.main-nav *')].find(e=>e.textContent.trim()==='设置')?.click()")
time.sleep(2); shot("06-settings")
