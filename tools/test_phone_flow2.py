import sys, json, urllib.request, time, base64
sys.path.insert(0,'pydeps')
import websocket
port = sys.argv[1] if len(sys.argv)>1 else '9222'
tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
page=[t for t in tabs if t.get("type")=="page"][0]
ws=websocket.create_connection(page["webSocketDebuggerUrl"], timeout=90, suppress_origin=True)
i=[0]
def call(m,p=None):
    i[0]+=1; ws.send(json.dumps({"id":i[0],"method":m,"params":p or {}}))
    while True:
        msg=json.loads(ws.recv())
        if msg.get("id")==i[0]: return msg.get("result",{})
def ev(e):
    r=call("Runtime.evaluate",{"expression":e,"returnByValue":True,"awaitPromise":True})
    if "exceptionDetails" in r: return "EXC "+str(r["exceptionDetails"].get("text"))[:300]
    return r.get("result",{}).get("value")
call("Page.enable"); call("Runtime.enable")

# 导航到 我的 > 账号
ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('我的'))?.click()")
time.sleep(1.5)
ev("[...document.querySelectorAll('.segment-item')].find(e=>e.textContent.includes('账号'))?.click()")
time.sleep(2.5)
print("phone panel present:", ev("!!document.querySelector('.phone-login')"))

# 填手机号
print("set phone:", ev("""(()=>{const el=document.querySelector('#phone-number');
  if(!el) return 'no-input';
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(el,'13800138000');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  return el.value})()"""))
time.sleep(0.8)
print("send btn disabled:", ev("document.querySelector('.phone-send')?.disabled"))

# 点获取验证码
ev("document.querySelector('.phone-send')?.click()")
time.sleep(7)
print("btn text after send:", ev("document.querySelector('.phone-send')?.textContent"))
print("toast:", ev("document.querySelector('.toast')?.textContent || '(none)'"))
print("error:", ev("document.querySelector('.phone-error')?.textContent || '(none)'"))
r=call("Page.captureScreenshot",{"format":"png"})
open('shots-new/14-phone-sent.png','wb').write(base64.b64decode(r.get('data')))
print("shot 14-phone-sent")
