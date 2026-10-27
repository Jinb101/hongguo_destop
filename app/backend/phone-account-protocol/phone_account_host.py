"""Private pipe protocol; no TCP listener, credential logs or automatic SMS."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import json
import re
from phone_account_flow import AccountFlow, AccountError
from phone_account_transport import AccountTransport, LIBRARY
from phone_account_device import initialize, InitializationError


class AccountHost:
    def __init__(self, device_path, transport_factory=AccountTransport, initializer=initialize):
        self.device_path = Path(device_path)
        self.transport_factory, self.initializer = transport_factory, initializer
        self.flow = AccountFlow(transport_factory(self.device_path))

    def status(self):
        value = self.flow.status()
        # A fresh installation is usable without registering merely by opening
        # the app. Component/context validation still happens locally.
        if self.flow.transport.context is None:
            value['loginAvailable'] = True
        else:
            try:
                self.flow.transport.ready()
                value['loginAvailable'] = True
            except AccountError as error:
                value.update(loginAvailable=False, unavailableReason=str(error))
        return value

    def handle(self, request):
        action = request.get('action')
        if action == 'status':
            return self.status()
        if action == 'send':
            phone = request.get('phone')
            if not isinstance(phone, str) or not re.fullmatch(r'1[0-9]{10}', phone):
                raise AccountError('请输入中国大陆 11 位手机号')
            if self.flow.transport.context is None:
                # Only this explicit user action may register. The initializer's
                # durable attempt marker prevents replay after unknown results.
                try:
                    self.initializer(self.device_path)
                    self.flow.transport.client.close()
                    self.flow = AccountFlow(self.transport_factory(self.device_path))
                except InitializationError:
                    raise AccountError('账号设备准备未完成，未发送验证码；请通过设置中的诊断反馈，勿连续重试') from None
            self.flow.send_code(phone)
        elif action == 'login':
            self.flow.login(request.get('phone'), request.get('code'))
        elif action == 'continue':
            self.flow.continue_verification()
        elif action == 'logout':
            self.flow.cancel()
        elif action == 'library':
            if not self.flow.uid:
                raise AccountError('请先登录红果账号')
            if request.get('path') not in LIBRARY:
                raise AccountError('不支持的云片单操作')
            return self.flow.transport.request(request['path'], extra=request.get('query'))
        else:
            raise AccountError('不支持的账号操作')
        return self.status()


def main():
    # Parent supplies only a protected-device path on stdin after owning the child.
    first=sys.stdin.buffer.readline(32768)
    try:
        init=json.loads(first)
        host=AccountHost(init['devicePath'])
        unavailable=''
    except Exception:
        host=None;unavailable='账号运行组件或独立设备资料不可用，请检查候选版'
    while True:
        line=sys.stdin.buffer.readline(65537)
        if not line:break
        if len(line)>65536:break
        try:
            request=json.loads(line);action=request.get('action')
            if host is None:
                if action!='status':raise AccountError(unavailable)
                result={'authenticated':False,'loginAvailable':False,'unavailableReason':unavailable,'displayName':'','retryAfter':0,'phase':'unavailable'}
            else:result=host.handle(request)
            reply={'ok':True,'value':result}
        except AccountError as e:reply={'ok':False,'error':str(e)}
        except Exception:reply={'ok':False,'error':'账号操作未完成，请重新打开账号页检查状态'}
        sys.stdout.write(json.dumps(reply,ensure_ascii=True,separators=(',',':'))+'\n');sys.stdout.flush()
    if host:host.flow.cancel()


if __name__=='__main__':main()
