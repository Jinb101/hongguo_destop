import { Component } from 'react'

/**
 * 错误边界
 *
 * 逆向还原过程中遇到过一次真实事故：
 * 上游 /episodes 返回的结构抖动（数组 → 对象）导致 PlayerView 里
 * `episodes.filter` 抛错，React 直接卸载了整棵树，
 * 用户看到的是一片空白 —— 所有页面都进不去了。
 *
 * 这个边界把故障范围限制在单个视图内：
 * 播放页挂了，首页、搜索、收藏依然可用。
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // 仅记录到控制台，不上报到任何外部服务
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info?.componentStack)
  }

  handleRetry = () => {
    this.setState({ error: null, info: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="view-error">
        <div className="empty-icon" aria-hidden="true">!</div>
        <h2>{this.props.title ?? '这个页面出了点问题'}</h2>
        <p className="muted">{error.message || String(error)}</p>
        <div className="view-error-actions">
          <button type="button" className="btn btn-primary" onClick={this.handleRetry}>
            重试
          </button>
          {this.props.onExit ? (
            <button type="button" className="btn btn-ghost" onClick={this.props.onExit}>
              返回首页
            </button>
          ) : null}
        </div>
      </div>
    )
  }
}
