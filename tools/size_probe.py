import json, urllib.request, sys
sys.path.insert(0,'pydeps')
import websocket
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
print("total base64 img bytes (MB):", ev("Math.round([...document.querySelectorAll('img')].reduce((s,i)=>s+(i.src.length),0)/1048576*10)/10"))
print("distinct img src count:", ev("new Set([...document.querySelectorAll('img')].map(i=>i.src)).size"))
print("avg src length KB:", ev("Math.round([...document.querySelectorAll('img')].reduce((s,i)=>s+i.src.length,0)/document.querySelectorAll('img').length/1024)"))
print("DOM innerHTML size MB:", ev("Math.round(document.documentElement.outerHTML.length/1048576*10)/10"))
print("grid scroll height:", ev("document.querySelector('.series-grid')?.scrollHeight"))
print("grid cols:", ev("getComputedStyle(document.querySelector('.series-grid')).gridTemplateColumns"))
