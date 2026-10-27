import sys, json, urllib.request, time, base64, os
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
    if "exceptionDetails" in r: return "EXC "+str(r["exceptionDetails"].get("text"))[:250]
    return r.get("result",{}).get("value")
def shot(n):
    r=call("Page.captureScreenshot",{"format":"png"})
    open(f'shots-new/{n}.png','wb').write(base64.b64decode(r.get('data')))
    print('shot', n)
call("Page.enable"); call("Runtime.enable")
time.sleep(3)

print("=== 账号页 ===")
ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('我的'))?.click()")
time.sleep(1.5)
ev("[...document.querySelectorAll('.segment-item')].find(e=>e.textContent.includes('账号'))?.click()")
time.sleep(3)
shot("12-account")
print("PHONE FORM:", ev("""JSON.stringify({
  hasPhoneInput: !!document.querySelector('#phone-number'),
  hasCodeInput: !!document.querySelector('#phone-code'),
  sendBtn: [...document.querySelectorAll('button')].find(b=>b.textContent.includes('获取验证码'))?.textContent,
  submitBtn: [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='登录')?.textContent,
  deadScanBtn: [...document.querySelectorAll('button')].some(b=>b.textContent.includes('扫码登录')),
  note: document.querySelector('.phone-note')?.textContent?.slice(0,60),
})"""))
# 打开一个剧，进播放页看遮罩位置
print()
print("=== 播放器遮罩位置 ===")
ev("[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('首页'))?.click()")
time.sleep(5)
ev("document.querySelector('.card .cover')?.click()")
time.sleep(3)
ev("[...document.querySelectorAll('.sheet button')].find(e=>e.textContent.includes('立即播放'))?.click()")
time.sleep(8)
shot("13-player-overlay")
print("OVERLAY:", ev("""JSON.stringify({
  overlayTop: document.querySelector('.vsurface-overlay')?.getBoundingClientRect().top,
  overlayBottom: document.querySelector('.vsurface-overlay')?.getBoundingClientRect().bottom,
  videoBottom: document.querySelector('video')?.getBoundingClientRect().bottom,
  videoH: document.querySelector('video')?.getBoundingClientRect().height,
  hasVideo: !!document.querySelector('video'),
  src: (document.querySelector('video')?.src||'').slice(0,110),
})"""))
