/**
 * Web Application Entry
 * Renders the root React node.
 *
 * Provides:
 * - (None) Self-executing initialization module.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app.js'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
