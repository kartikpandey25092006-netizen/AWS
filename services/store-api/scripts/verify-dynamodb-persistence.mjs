import { randomUUID } from 'node:crypto'
import { createDynamoDbClients, DynamoDbStore } from '../src/dynamodb-store.mjs'

const region = process.env.AWS_REGION || 'us-east-1'
const tableName = process.env.STORE_DYNAMODB_TABLE

function openStore() {
  const clients = createDynamoDbClients({ region, endpoint: process.env.STORE_DYNAMODB_ENDPOINT })
  return new DynamoDbStore({ ...clients, tableName })
}

const customerSub = `persistence-check-${randomUUID()}`
const idempotencyKey = randomUUID()
let firstStore = openStore()

try {
  await firstStore.checkConnection()
  const created = await firstStore.createOrder(
    customerSub,
    [{ productId: 'orbit-desk-lamp', quantity: 1 }],
    idempotencyKey,
    null,
  )
  if (!created.created) throw new Error('The persistence check did not create a new order.')
  const orderId = created.order.id

  firstStore.close()
  firstStore = null

  const secondStore = openStore()
  try {
    const persisted = await secondStore.getOrderForCustomer(orderId, customerSub)
    if (!persisted || persisted.id !== orderId) throw new Error('The order was not found through a new DynamoDB client.')

    const duplicate = await secondStore.createOrder(
      customerSub,
      [{ productId: 'orbit-desk-lamp', quantity: 1 }],
      idempotencyKey,
      null,
    )
    if (duplicate.created || duplicate.order.id !== orderId) {
      throw new Error('The persisted idempotency key did not return the original order.')
    }

    await secondStore.cancelOrder(orderId, customerSub)
    console.log(`DynamoDB persistence verified for order ${orderId}. Test order was cancelled.`)
  } finally {
    secondStore.close()
  }
} finally {
  firstStore?.close()
}
