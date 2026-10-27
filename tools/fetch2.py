import json, urllib.request, os, sys
sys.path.insert(0,'pydeps')
import websocket
tabs=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
ws_url=[t for t in tabs if t.get("type")=="page"][0]["webSocketDebuggerUrl"]
ws=websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
i=[0]
def call(method, params=None):
    i[0]+=1
    ws.send(json.dumps({"id":i[0],"method":method,"params":params or {}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==i[0]: return m.get("result",{})

for url,name in [("http://tauri.localhost/assets/index-BrrRYD-G.css","index-BrrRYD-G.css"),
                 ("http://tauri.localhost/assets/index-CTpIsaLU.js","index-CTpIsaLU.js")]:
    expr = "fetch('%s').then(r=>r.text()).then(t=>t)" % url
    r=call("Runtime.evaluate",{"expression":expr,"awaitPromise":True,"returnByValue":True})
    res=r.get("result",{})
    val=res.get("value")
    if isinstance(val,dict):
        print("dict keys",list(val.keys())); val=val.get("value")
    if not isinstance(val,str):
        print("ERR",name,json.dumps(r)[:400]); continue
    open('frontend/'+name,'w',encoding='utf-8').write(val)
    print(name,len(val))
