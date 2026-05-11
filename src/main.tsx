import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Simple localStorage-backed shim for window.storage (used by the app for persistence)
;(window as any).storage = {
  get: async (k: string) => {
    const v = localStorage.getItem(k)
    return v === null ? null : { value: v }
  },
  set: async (k: string, v: string) => localStorage.setItem(k, v),
  delete: async (k: string) => localStorage.removeItem(k),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)