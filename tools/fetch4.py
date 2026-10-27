import json, urllib.request, os, sys, time
sys.path.insert(0,'pydeps')
import websocket
tabs=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
ws_url=[t for t in tabs if t.get("type")=="page"][0]["webSocketDebuggerUrl"]
ws=websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
i=[0]
def send(m,p=None):
    i[0]+=1; ws.send(json.dumps({"id":i[0],"method":m,"params":p or {}})); return i[0]
def wait_id(my):
    while True:
        msg=json.loads(ws.recv())
        if msg.get("id")==my: return msg.get("result",{})
send("Network.enable"); wait_id(i[0])
send("Page.enable"); wait_id(i[0])
bodies={}
wait_id(send("Page.reload",{"ignoreCache":True}))
t0=time.time()
while time.time()-t0<30:
    try: msg=json.loads(ws.recv())
    except Exception: break
    if msg.get("method")=="Network.responseReceived":
        p=msg["params"]; bodies[p["requestId"]]=p["response"]["url"]
    if msg.get("method")=="Network.loadingFinished":
        rid=msg["params"]["requestId"]
        url=bodies.get(rid,"")
        if url.endswith((".css",".js",".html")):
            r=wait_id(send("Network.getResponseBody",{"requestId":rid}))
            body=r.get("body","")
            if r.get("base64Encoded"): body=__import__("base64").b64decode(body).decode('utf-8','replace')
            name=url.split("/")[-1] or "index.html"
            if url.rstrip('/').endswith('tauri.localhost'): name="index.html"
            open('frontend/raw-'+name,'w',encoding='utf-8').write(body)
            print("SAVED",name,len(body))
