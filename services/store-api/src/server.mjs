import { createStoreApi } from './app.mjs'
import { createCognitoAccessTokenVerifier } from './auth.mjs'
import { createDynamoDbClients, DynamoDbStore } from './dynamodb-store.mjs'
import { MemoryStore } from './memory-store.mjs'
import { createApplicationMetrics } from './metrics.mjs'
import { createLexChatResponder } from './lex-chat.mjs'

const port = Number.parseInt(process.env.PORT || '3100', 10)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')
const host = process.env.STORE_API_HOST || '127.0.0.1'
const allowedOrigins = (process.env.STOREFRONT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const verifyAccessToken = createCognitoAccessTokenVerifier({
  userPoolId: process.env.STORE_COGNITO_USER_POOL_ID,
  clientId: process.env.STORE_COGNITO_APP_CLIENT_ID,
})

if (!verifyAccessToken) {
  console.warn('Storefront Cognito settings are missing; protected routes will return 503.')
}

const database = process.env.STORE_DATABASE || 'dynamodb'
let repository
if (database === 'dynamodb') {
  const clients = createDynamoDbClients({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.STORE_DYNAMODB_ENDPOINT,
  })
  repository = new DynamoDbStore({
    ...clients,
    tableName: process.env.STORE_DYNAMODB_TABLE,
  })
  await repository.checkConnection()
} else if (database === 'memory' && process.env.NODE_ENV !== 'production') {
  console.warn('Store API is using volatile memory storage. Orders will be lost on restart.')
  repository = new MemoryStore()
} else {
  throw new Error('STORE_DATABASE must be dynamodb. memory is allowed only outside production.')
}

const metrics = process.env.STORE_METRICS_ENABLED === 'true' ? createApplicationMetrics({
  instanceId: process.env.STORE_METRICS_INSTANCE_ID,
  region: process.env.AWS_REGION,
}) : null
const recognizeChatMessage = createLexChatResponder({
  botId: process.env.STORE_LEX_BOT_ID,
  botAliasId: process.env.STORE_LEX_BOT_ALIAS_ID,
  localeId: process.env.STORE_LEX_LOCALE_ID || 'en_US',
  region: process.env.AWS_REGION || 'us-east-1',
})
const server = createStoreApi({ repository, allowedOrigins, verifyAccessToken, observeRequest: metrics?.record, recognizeChatMessage })
server.listen(port, host, () => {
  metrics?.start()
  console.log(`Store API listening on ${host}:${port} with ${database} storage`)
})

function shutdown() {
  server.close(async () => {
    await metrics?.stop()
    await repository.close?.()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
