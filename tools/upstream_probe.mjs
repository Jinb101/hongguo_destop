// 上游接口可用性探针：免签、游客态，逐个接口返回 code/message/字节数。
// 用法: node tools/upstream_probe.mjs [host]
import crypto from 'node:crypto';
import fs from 'node:fs';

const HOST = process.argv[2] || 'api5-normal-sinfonlinea.fqnovel.com';
const store = {};

const BASE = {
  aid: '8662',
  app_name: 'novelread',
  version_code: '74132',
  version_name: '7.4.1.32',
  channel: 'audit',
  device_platform: 'android',
  device_type: 'audit-windows',
  os_version: '12',
  update_version_code: '74132',
};

function md5upper(buf) {
  return crypto.createHash('md5').update(buf).digest('hex').toUpperCase();
}

async function call(name, method, path, { query = {}, body } = {}) {
  const q = new URLSearchParams({ ...BASE, _rticket: String(Date.now()) });
  for (const [k, v] of Object.entries(query)) q.set(k, String(v));
  const url = `https://${HOST}${path}?${q}`;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'okhttp/4.10.0',
    'x-tt-store-region': 'cn-sh',
    'x-tt-store-region-src': 'uid',
    'passport-sdk-version': '5051452',
    'sdk-version': '2',
  };
  let payload;
  if (body !== undefined) {
    payload = Buffer.from(JSON.stringify(body));
    headers['x-ss-stub'] = md5upper(payload);
  }
  const t0 = Date.now();
  let line;
  try {
    const r = await fetch(url, { method, headers, body: payload });
    const buf = Buffer.from(await r.arrayBuffer());
    let code = '-', msg = '-';
    try {
      const j = JSON.parse(buf.toString('utf8'));
      code = j.code ?? '-';
      msg = j.message ?? '-';
    } catch {
      msg = buf.length ? `<non-json ${buf.subarray(0, 24)}>`.trim() : 'empty';
    }
    line = `${method} ${path} -> ${r.status} bytes=${buf.length} code=${code} msg=${msg} ${Date.now() - t0}ms`;
    store[name] = buf;
  } catch (e) {
    line = `${method} ${path} -> FETCH_ERROR ${e.message}`;
  }
  console.log(name.padEnd(10), line);
  return name;
}

const selItems = (genre, extra = {}) => ({
  category_dim_epoch: [],
  online_time: [],
  gender: [],
  category_dim_role: [],
  genre: [genre],
  sort: [],
  category_dim_theme: [],
  ...extra,
});

const results = [];
results.push(await call('filters', 'POST', '/reading/distribution/category/landpage/v', {
  body: {
    filter_ids: '', req_scene: 'default', offset: 0, limit: 1,
    need_selector_panel: true, req_type: 'default', client_req_type: 3,
    select_items: selItems('short_play'), session_id: '',
  },
}));

results.push(await call('latest', 'POST', '/reading/distribution/category/landpage/v', {
  body: {
    filter_ids: '', req_scene: 'default', offset: 0, need_selector_panel: false, limit: 18,
    select_items: selItems('short_play', { sort: ['online_time'] }),
    session_id: '', req_type: 'only_content', client_req_type: 3,
  },
}));

results.push(await call('rank', 'GET', '/reading/bookapi/bookmall/cell/change/v', {
  query: {
    cell_id: '7470092475068071998', tab_type: '26', client_req_type: '2', client_template: '2',
    screen_width_px: '1350', selected_items: 'comic_series_rank',
    sub_selected_items: 'comic_series_hot_rank', session_uuid: crypto.randomUUID(),
  },
}));

results.push(await call('search', 'GET', '/reading/bookapi/search/tab/v', {
  query: { query: '皇子', tab_name: 'feed', search_source: '1', offset: '0', count: '0', use_correct: 'true' },
}));

results.push(await call('mall-home', 'GET', '/reading/bookapi/bookmall/home/page/v', {
  query: { tab_type: '26', screen_width_px: '1350', session_uuid: crypto.randomUUID() },
}));

for (const [name, buf] of Object.entries(store)) {
  if (buf.length > 200) fs.writeFileSync(`rea-out/probe-${name}.json`, buf);
}
console.log('原始响应已落盘 rea-out/probe-<name>.json (>200B 的)');
