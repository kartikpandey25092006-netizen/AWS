import { createStoreApi } from './app.mjs'
import { MemoryStore } from './memory-store.mjs'

const port = Number.parseInt(process.env.PORT || '3100', 10)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')
const allowedOrigins = (process.env.STOREFRONT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const server = createStoreApi({ repository: new MemoryStore(), allowedOrigins })
server.listen(port, '0.0.0.0', () => {
  console.log('Store API listening on port ' + port)
})

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
