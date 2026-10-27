import { describe, it, expect } from 'vitest'

import { resolveRoute } from '../src/lib/ipc.js'
import { extractCellItems, normalizeSeries, normalizeSeriesList } from '../src/lib/normalize.js'

/**
 * 命令路由契约
 *
 * 前端与原生层之间只剩一张表：API_ROUTES。
 * 这里锁住「哪个命令走上游、走哪个榜单、哪些功能因缺签名而明确不可用」，
 * 因为这几处一旦漂了，页面只会显示「加载失败」而看不出原因。
 */
describe('命令路由表', () => {
  it('榜单按剧场映射到上游 selected_items / sub_selected_items', () => {
    const human = resolveRoute('get_rank', { rankType: 'hot', genre: 'short_play', limit: 20 })
    expect(human.upstream.path).toBe('/reading/bookapi/bookmall/cell/change/v')
    expect(human.upstream.query.selected_items).toBe('human')
    expect(human.upstream.query.sub_selected_items).toBe('human_hot_play')
    expect(human.limit).toBe(20)

    expect(
      resolveRoute('get_rank', { rankType: 'new', genre: 'comic_series' }).upstream.query
        .sub_selected_items,
    ).toBe('comic_series_new_rank')
    expect(
      resolveRoute('get_rank', { rankType: 'recommend', genre: 'ai_series' }).upstream.query
        .sub_selected_items,
    ).toBe('ai_playlet_hot_sc')
  })

  it('未知榜别与未知剧场回落到真人剧热播榜，而不是拼出无效 id', () => {
    const q = resolveRoute('get_rank', { rankType: '不存在', genre: '不存在' }).upstream.query
    expect(q.selected_items).toBe('human')
    expect(q.sub_selected_items).toBe('human_hot_play')
  })

  it('首页与上新复用同一批榜单接口', () => {
    expect(resolveRoute('get_recommendations', { genre: 'short_play' }).upstream.query
      .sub_selected_items).toBe('human_hot_sc')
    expect(resolveRoute('get_new_releases', { genre: 'ai_series' }).upstream.query
      .sub_selected_items).toBe('ai_playlet_new_rank')
  })

  it('免签拿不到数据的接口明确标记为需要签名', () => {
    for (const command of ['search_novelfm', 'get_series', 'get_validation_episodes', 'get_validation_playback', 'get_category', 'get_taste_tags']) {
      expect(resolveRoute(command, {}).blocked).toMatch(/X-Argus 签名/)
    }
  })

  it('手机号登录明确不可用，不再伪装成后端接口', () => {
    expect(resolveRoute('phone_account_send_code', {}).blocked).toMatch(/自建壳未实现/)
  })

  it('收藏与历史是本机状态，不出网', () => {
    expect(resolveRoute('list_favorites', {}).local).toBe('favorites')
    expect(resolveRoute('list_history', {}).local).toBe('history')
  })

  it('上游没有的能力给出占位值，而不是让页面报错', () => {
    expect(resolveRoute('check_app_update', {}).stub).toEqual({ has_update: false })
    expect(resolveRoute('get_diagnostic_summary', {}).stub).toEqual({})
    expect(resolveRoute('list_devices', {}).stub).toEqual([])
    expect(resolveRoute('get_boss_playback_state', {}).stub).toEqual({ enabled: false })
  })

  it('未知命令给出可定位的错误', () => {
    expect(() => resolveRoute('set_favorite', { seriesId: 1 })).toThrow(/未知命令/)
  })
})

describe('榜单响应摊平', () => {
  /** 真实结构的最小切片（来自 2026-10-27 免签抓包）。 */
  const cellPayload = {
    data: {
      cell_view: {
        has_more: true,
        next_offset: 10,
        cell_data: [
          {
            show_type: 505,
            video_data: [
              {
                series_id: '7637569673411709976',
                vid: '7637571316760972313',
                title: '谁说没灵根不能修仙的？之无灵证道',
                cover: 'https://p3-reading-sign.fqnovelpic.com/novel-pic/x.jpg',
                episode_cnt: 78,
                play_cnt: 5066037,
                score: '8.1',
                copyright: '深圳幕后玩家文化科技有限公司',
                video_desc: '在蛮荒界灵根为尊……'.repeat(20),
              },
            ],
          },
          { video_data: { series_id: '2', title: '单对象形态', play_cnt: 1234 } },
          { video_data: [{ title: '缺 series_id 直接丢弃' }] },
        ],
      },
    },
  }

  it('三层嵌套压平成条目，缺 series_id 的行不入列表', () => {
    const items = extractCellItems(cellPayload)
    expect(items).toHaveLength(2)
    expect(items[0].series_id).toBe('7637569673411709976')
    expect(items[0].intro.length).toBeLessThanOrEqual(120)
    expect(items[1].title).toBe('单对象形态')
  })

  it('摊平结果继续走 normalizeSeries，热度按数字格式化', () => {
    const [first] = normalizeSeriesList(extractCellItems(cellPayload))
    expect(first.id).toBe('7637569673411709976')
    expect(first.episodes).toBe(78)
    expect(first.hot).toBe('506.6 万热度')
    expect(first.genres).toContain('深圳幕后玩家文化科技有限公司')
  })

  it('空响应与结构缺失一律给空数组，不抛错', () => {
    expect(extractCellItems(null)).toEqual([])
    expect(extractCellItems({ data: {} })).toEqual([])
    expect(normalizeSeriesList(extractCellItems({ data: { cell_view: { cell_data: null } } }))).toEqual([])
  })
})

describe('normalizeSeries 兼容两种上游形态', () => {
  it('驼峰（原 IPC 形态）与下划线（后端形态）归一到同一结构', () => {
    const camel = normalizeSeries({
      seriesId: '1',
      title: '剧A',
      episodeCount: 10,
      hotText: '6981万热度',
      tags: ['玄幻'],
    })
    const snake = normalizeSeries({
      series_id: '1',
      title: '剧A',
      episode_cnt: 10,
      play_cnt: 69810000,
    })
    expect(camel.id).toBe(snake.id)
    expect(camel.episodes).toBe(snake.episodes)
    expect(camel.hot).toBe('6981万热度')
    expect(snake.hot).toBe('6981.0 万热度')
    expect(camel.genres).toEqual(['玄幻'])
  })

  it('缺 id 的脏数据被丢弃，不会把 undefined 传进渲染', () => {
    expect(normalizeSeries({ title: '没有 id' })).toBeNull()
    expect(normalizeSeries(null)).toBeNull()
  })
})
