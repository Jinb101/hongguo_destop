import { chromium } from 'playwright'
import fs from 'fs'

// 用 mock 后端注入真实形态的封面数据，验证渲染层与视觉
const MOCK = {
  id: 'mock-1',
  series_id: 's1',
  title: '夜色渐浓',
  total_episode: 80,
  hot_score: 12345678,
  genre_name: '都市 · 情感',
  cover: 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="914"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b2f5e"/><stop offset="1" stop-color="#8a3a52"/></linearGradient></defs><rect width="640" height="914" fill="url(#g)"/><text x="320" y="460" font-size="52" fill="#fff" text-anchor="middle" font-family="sans-serif">夜色渐浓</text></svg>`),
}

const browser = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.addInitScript((mock) => {
  const items = Array.from({ length: 60 }, (_, i) => ({
    ...mock,
    series_id: 's' + i,
    title: ['夜色渐浓','王后归来','霸总的替身新娘','重生之我在星际当军师','长安十二时辰','错撩禁欲王爷','离婚后我成了顶流','神医下山','天才俱乐部','末世求生'][i % 10] + (i > 9 ? ' ' + (i + 1) : ''),
    total_episode: 30 + ((i * 7) % 90),
    hot_score: 10000000 + i * 123456,
    genre_name: ['都市','古装','玄幻','悬疑','甜宠'][i % 5],
  }))
  window.__MOCK_ITEMS__ = items
  // 拦截 fetch：模拟后端 API 返回
  const origFetch = window.fetch
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    const j = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } })
    if (url.includes('/rank')) return j({ board: 'hot', name: '热播榜', items })
    if (url.includes('/latest')) return j({ genre: 'short_play', name: '真人剧', mode: '今日上新', count: 24, items: items.slice(0, 24) })
    if (url.includes('/filters')) return j({ genre: 'short_play', name: '真人剧', rows: [
      { key: 'theme', name: '题材', type: 'multi_select', items: [{id:'xiu',name:'玄幻'},{id:'ai',name:'爱情'},{id:'shi',name:'悬疑'},{id:'cheng',name:'都市'}] },
      { key: 'sort', name: '排序', type: 'select', items: [{id:'hot',name:'最热'},{id:'new',name:'最新'}] },
    ]})
    if (url.includes('/browse')) return j({ genre: 'ai_series', name: 'AI剧', count: 40, items: items.slice(0, 40) })
    if (url.includes('/search')) return j({ query: 'x', results: items.slice(0, 12) })
    if (url.includes('/episodes')) return j({ meta: {}, episodes: Array.from({length:40},(_,i)=>({ep:i+1,title:'第'+(i+1)+'集'})) })
    return origFetch(input, init)
  }
}, MOCK)

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
fs.mkdirSync('shots-new', { recursive: true })
await page.screenshot({ path: 'shots-new/01-home.png' })

// 排行榜
await page.click('text=排行榜').catch(()=>{})
await page.waitForTimeout(800)
await page.screenshot({ path: 'shots-new/02-rank.png' })

// 我的
await page.click('text=我的').catch(()=>{})
await page.waitForTimeout(600)
await page.screenshot({ path: 'shots-new/03-mine.png' })

// 搜索
await page.click('text=搜索').catch(()=>{})
await page.waitForTimeout(500)
await page.screenshot({ path: 'shots-new/04-search.png' })

// 设置
await page.click('text=更多').catch(()=>{})
await page.waitForTimeout(300)
await page.click('text=设置').catch(()=>{})
await page.waitForTimeout(500)
await page.screenshot({ path: 'shots-new/05-settings.png' })

// 性能指标
const stats = await page.evaluate(() => ({
  dom: document.querySelectorAll('*').length,
  imgs: document.querySelectorAll('img').length,
  eagerImgs: [...document.querySelectorAll('img')].filter(i=>i.getAttribute('loading')!=='lazy').length,
  cards: document.querySelectorAll('.card').length,
  heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null,
}))
console.log('STATS', JSON.stringify(stats))
await browser.close()
