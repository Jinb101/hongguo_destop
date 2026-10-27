import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { applyTheme, readTheme } from './lib/theme.js'
import './styles/app.css'

// 首帧就把主题写到 <html>，避免 React 挂载后才有皮肤正确颜色。
applyTheme(readTheme())

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
