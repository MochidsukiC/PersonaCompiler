import { createRoot } from 'react-dom/client'
import App from './App'
import '@xyflow/react/dist/style.css'
import '@xterm/xterm/css/xterm.css'
import './style.css'

const root = document.getElementById('root')
if (!root) throw new Error('アプリの描画先がありません')
createRoot(root).render(<App />)
