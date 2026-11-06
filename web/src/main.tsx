import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startHost } from './core/host'
// Feature modules register their host message handlers on import.
import './core/session'
import './core/data'
import './features/pets'
import './features/map'
import './features/events'
import './features/progress'
import './features/farm'
import './features/merchant'
import './features/bossmod'
import './features/market'
// Optional local modules (not in the public repository).
import.meta.glob('./private/*.ts', { eager: true })

createRoot(document.getElementById('root')!).render(<App />)
startHost()
