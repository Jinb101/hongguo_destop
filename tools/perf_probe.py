import json, urllib.request, sys, time
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

def ev(expr):
    r=call("Runtime.evaluate",{"expression":expr,"returnByValue":True,"awaitPromise":True})
    return r.get("result",{}).get("value")

print("DOM nodes:", ev("document.querySelectorAll('*').length"))
print("img count:", ev("document.querySelectorAll('img').length"))
print("img complete:", ev("[...document.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth>0).length"))
print("cards:", ev("document.querySelectorAll('.card-title').length"))
print("grid children:", ev("document.querySelector('.series-grid')?.children.length"))
print("memory:", json.dumps(ev("performance.memory ? {used:performance.memory.usedJSHeapSize, limit:performance.memory.jsHeapSizeLimit} : null")))
print("nav items:", ev("[...document.querySelectorAll('.main-nav a,.main-nav button,.sidebar a,.sidebar button')].map(e=>e.textContent.trim())"))
print("sidebar:", ev("[...document.querySelectorAll('.sidebar *')].filter(e=>e.children.length===0&&e.textContent.trim()).map(e=>e.textContent.trim()).slice(0,40)"))
print("topbar:", ev("[...document.querySelectorAll('.topbar *')].filter(e=>e.children.length===0&&e.textContent.trim()).map(e=>e.textContent.trim()).slice(0,30)"))

print("--- img attrs ---")
print(ev("JSON.stringify([...document.querySelectorAll('img')].slice(0,3).map(i=>({loading:i.getAttribute('loading'),src:i.src.slice(0,80),cls:i.className,w:i.naturalWidth,h:i.naturalHeight})))"))
print("--- grid overflow/visible ---")
print(ev("JSON.stringify({scrollH:document.documentElement.scrollHeight, clientH:document.documentElement.clientHeight, innerH:window.innerHeight})"))
print("--- layout thrash: fixed positioned count ---")
print(ev("document.querySelectorAll('*').length"))
print("--- transitions/animations ---")
print(ev("JSON.stringify([...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).transitionDuration!=='0s').length)"))
print("--- filters/backdrop ---")
print(ev("JSON.stringify([...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return s.backdropFilter&&s.backdropFilter!=='none'}).length)"))
print("--- box-shadow heavy ---")
print(ev("JSON.stringify([...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).boxShadow!=='none').length)"))
