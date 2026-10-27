import json, urllib.request, os, sys, base64, hashlib
sys.path.insert(0,'pydeps')
import websocket
tabs=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
ws_url=[t for t in tabs if t.get("type")=="page"][0]["webSocketDebuggerUrl"]
ws=websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
i=[0]
def send(method, params=None):
    i[0]+=1
    ws.send(json.dumps({"id":i[0],"method":method,"params":params or {}}))
    return i[0]
def wait_id(myid):
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==myid: return m.get("result",{})

send("Page.enable"); wait_id(i[0])
send("Network.enable"); wait_id(i[0])
# reload to capture responses
myid=send("Page.reload",{"ignoreCache":True})
bodies={}
done=False
import time
t0=time.time()
while time.time()-t0<40:
    try:
        m=json.loads(ws.recv())
    except Exception:
        break
    if m.get("method")=="Network.loadingFinished":
        bodies[m["params"]["requestId"]]=m["params"].get("encodedDataLength",0)
    if m.get("method")=="Network.getResponseBody":
        pass
# simpler: request each url via Network domain by navigating? Instead use Page.navigate to asset then read
for url,name in [("http://tauri.localhost/assets/index-BrrRYD-G.css","index-BrrRYD-G.css"),
                 ("http://tauri.localhost/assets/index-CTpIsaLU.js","index-CTpIsaLU.js")]:
    myid=send("Page.navigate",{"url":url})
    wait_id(myid)
    time.sleep(2)
    r=wait_id(send("Runtime.evaluate",{"expression":"document.documentElement.outerHTML","returnByValue":True}))
    val=r.get("result",{}).get("value")
    if url.endswith(".js"):
        r=wait_id(send("Runtime.evaluate",{"expression":"document.body.innerText","returnByValue":True}))
        val=r.get("result",{}).get("value")
    if isinstance(val,str) and len(val)>100:
        open('frontend/'+name,'w',encoding='utf-8').write(val)
        print("OK",name,len(val))
    else:
        print("FAIL",name, str(val)[:200])
