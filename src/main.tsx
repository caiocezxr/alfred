import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/500-italic.css'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/400-italic.css'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/bodoni-moda/400.css'
import '@fontsource/bodoni-moda/500.css'
import '@fontsource/josefin-sans/300.css'
import '@fontsource/josefin-sans/400.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource/unbounded/500.css'
import '@fontsource/syne/700.css'
import './shared/tokens.css'
import { App } from './app/App'
import { applyTheme } from './shared/themes/themes'

applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('__TAURI_INTERNALS__' in window) {
  const show = () => import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().show()).catch(() => {})
  let shown = false
  const once = () => {
    if (shown) return
    shown = true
    void show()
  }
  requestAnimationFrame(() => requestAnimationFrame(once))
  setTimeout(once, 1500)
}
