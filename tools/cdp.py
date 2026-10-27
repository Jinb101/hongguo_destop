import json, urllib.request, sys
try:
    import websocket  # websocket-client
except ImportError:
    print("NO_WS"); sys.exit(2)
tabs=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
ws_url=[t for t in tabs if t.get("type")=="page"][0]["webSocketDebuggerUrl"]
ws=websocket.create_connection(ws_url, timeout=30, origin="http://127.0.0.1:9222", suppress_origin=True)
i=[0]
def call(method, params=None, wait=True):
    i[0]+=1
    ws.send(json.dumps({"id":i[0],"method":method,"params":params or {}}))
    if not wait: return None
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==i[0]:
            return m.get("result",{})
# get performance resource list
res=call("Performance.getMetrics")
entries=call("Runtime.evaluate",{"expression":"JSON.stringify(performance.getEntriesByType('resource').map(e=>e.name))","returnByValue":True})
print(entries.get("result",{}).get("value"))
