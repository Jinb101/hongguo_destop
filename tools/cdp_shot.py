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
call("Page.enable"); call("Runtime.enable")
ev("location.href='http://127.0.0.1:4173/'")
time.sleep(10)
shot("01-home")
print("STATS", ev("""JSON.stringify({dom:document.querySelectorAll('*').length, imgs:document.querySelectorAll('img').length, cards:document.querySelectorAll('.card').length, lazy:[...document.querySelectorAll('img')].filter(i=>i.getAttribute('loading')==='lazy').length, txt:document.body.innerText.slice(0,220)})"""))
