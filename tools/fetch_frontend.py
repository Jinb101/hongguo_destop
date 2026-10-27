import json, urllib.request, os, sys
sys.path.insert(0,'pydeps')
import websocket
os.makedirs('frontend', exist_ok=True)
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

# 1. document.documentElement.outerHTML
r=call("Runtime.evaluate",{"expression":"document.documentElement.outerHTML","returnByValue":True})
html=r.get("result",{}).get("value") or ""
open('frontend/index.html','w',encoding='utf-8').write(html)
print("index.html", len(html))

# 2. fetch css + js text
for url,name in [("http://tauri.localhost/assets/index-BrrRYD-G.css","index-BrrRYD-G.css"),
                 ("http://tauri.localhost/assets/index-CTpIsaLU.js","index-CTpIsaLU.js")]:
    r=call("Runtime.evaluate",{"expression":f"fetch('{url}').then(r=>r.text())","awaitPromise":True,"returnByValue":True})
    txt=r.get("result",{}).get("value")
    if txt is None:
        # fall back to result description
        print("ERR",name, json.dumps(r)[:300]); continue
    open('frontend/'+name,'w',encoding='utf-8').write(txt)
    print(name, len(txt))
