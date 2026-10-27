"""Anonymous player compatibility for the packaged public guest configuration.

The catalog keeps its existing client. Player requests use the complete public
guest profile without the obsolete signature. No account credentials are copied.
Only an empty successful response receives bounded retries; identities stay fixed.
"""
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlencode

ENDPOINT = '/novel/player/video_model/v1/'
BATCH_ENDPOINT = '/novel/player/multi_video_model/v1/'
HOST = 'https://api5-normal-sinfonlineb.fqnovel.com'
PARAMETERS = {
    'aid': '8662', 'app_name': 'novelread', 'version_code': '73532',
    'version_name': '7.3.5.32', 'manifest_version_code': '73532',
    'update_version_code': '73532', 'channel': 'update_64',
    'device_platform': 'android', 'os': 'android', 'ssmix': 'a',
    'device_type': '25053RT47C', 'device_brand': 'Redmi', 'language': 'zh',
    'os_api': '36', 'os_version': '16', 'resolution': '1280*2772',
    'dpi': '520', 'ac': 'wifi',
}
HEADERS = {
    'user-agent': 'com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)',
    'accept': 'application/json', 'x-xs-from-web': '0', 'sdk-version': '2',
    'content-type': 'application/json; charset=utf-8',
}
_LOCK = threading.Lock()


def load_identity(directory):
    """Persist once per application data directory; never replace on failure."""
    directory = Path(directory)
    if not directory.is_absolute() or not directory.is_dir():
        raise ValueError('An existing absolute application data directory is required')
    path = directory / 'public-player-device.json'
    with _LOCK:
        if not path.exists() and not path.is_symlink():
            identity = {key: str(10**18 + secrets.randbelow(8 * 10**18))
                        for key in ('device_id', 'iid')}
            try:
                with path.open('x', encoding='utf-8') as stream:
                    json.dump(identity, stream, separators=(',', ':'))
                    stream.flush()
                    os.fsync(stream.fileno())
            except FileExistsError:
                pass
        if path.is_symlink() or path.stat().st_size > 4096:
            raise ValueError('Invalid persisted public player identity')
        identity = json.loads(path.read_text(encoding='utf-8'))
        if (not isinstance(identity, dict) or set(identity) != {'device_id', 'iid'}
                or not all(isinstance(value, str) and re.fullmatch(r'[0-9]{19}', value)
                           for value in identity.values())):
            raise ValueError('Invalid persisted public player identity')
        return identity


def install(client, directory):
    """Install only for the known public guest; preserve custom account clients."""
    config = client.CFG
    public_headers = {'user-agent', 'x-tt-store-region', 'x-tt-store-region-src',
                      'passport-sdk-version', 'sdk-version'}
    query = config.get('base_query', {})
    if (set(key.lower() for key in config.get('session_headers', {})) - public_headers
            or query.get('channel') != 'audit'
            or query.get('device_type') != 'audit-windows'
            or set(query) - {'aid', 'app_name', 'version_code', 'version_name',
                             'channel', 'device_platform', 'device_type',
                             'os_version', 'update_version_code'}):
        return False
    original = client.api

    def api(method, path, body=None, extra_query=None, max_retries=3, signed=True):
        if path != ENDPOINT:
            return original(method, path, body=body, extra_query=extra_query,
                            max_retries=max_retries, signed=signed)
        if (method != 'POST' or extra_query or not isinstance(body, dict)
                or not re.fullmatch(r'[0-9]{8,24}', str(body.get('video_id', '')))):
            raise ValueError('Unexpected public player request')
        params = {**PARAMETERS, **load_identity(directory)}
        # The legacy single-video route now returns an empty successful body.
        # Reuse our provider's existing batch contract, requesting only this ID.
        # Normalize its envelope so track selection/decryption stay unchanged.
        video_id = str(body['video_id'])
        batch_body = {
            'mixed_video_id_map': {'1': [video_id]},
            'biz_param': {'detail_page_version': 0, 'device_level': 3,
                          'disable_digg_stat': False, 'disable_video_relate_book': False,
                          'need_all_video_definition': True, 'need_mp4_align': False,
                          'use_os_player': False, 'use_server_dns': False,
                          'video_platform': 1024},
        }
        url = HOST + BATCH_ENDPOINT + '?' + urlencode(params, safe='*~')
        raw = json.dumps(batch_body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        for delay in (0, 5, 12):
            if delay:
                time.sleep(delay)
            client.SG.throttle.wait()
            response = client.http_request('POST', url, data=raw, headers=dict(HEADERS),
                                           timeout=30, allow_redirects=False)
            try:
                # The real endpoint sometimes returns a zero-byte HTTP 200.
                # Keep the exact request and session. Never retry a rejection,
                # business error, nonempty malformed response or transport error.
                if response.status_code == 200 and not response.content and delay != 12:
                    continue
                if response.status_code != 200 or len(response.content) > 2 * 1024 * 1024:
                    raise client.UpstreamResponseError(response)
                try:
                    result = response.json()
                except ValueError:
                    raise client.UpstreamResponseError(response) from None
                client.SG.check_response(result)
                if not isinstance(result, dict) or type(result.get('code')) is not int or result['code'] != 0:
                    raise client.UpstreamResponseError(response)
                data = result.get('data')
                item = data.get(video_id) if isinstance(data, dict) else None
                if not isinstance(item, dict) or not item.get('video_model'):
                    raise client.UpstreamResponseError(response)
                return {**result, 'data': item}
            finally:
                response.close()

    client.api = api
    return True
