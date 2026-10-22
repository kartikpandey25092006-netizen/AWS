import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { createDynamoDbClients, DynamoDbStore, productRecord } from '../src/dynamodb-store.mjs'
import { seedProducts } from '../src/memory-store.mjs'

const region = process.env.AWS_REGION || 'us-east-1'
const tableName = process.env.STORE_DYNAMODB_TABLE
const clients = createDynamoDbClients({ region, endpoint: process.env.STORE_DYNAMODB_ENDPOINT })
const store = new DynamoDbStore({ ...clients, tableName })

try {
  await store.checkConnection()
  for (const product of seedProducts) {
    try {
      await clients.documentClient.send(new PutCommand({
        TableName: tableName,
        Item: productRecord(product),
        ConditionExpression: 'attribute_not_exists(pk)',
      }))
    } catch (error) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error
    }
  }
  console.log(`DynamoDB catalog is ready in ${tableName}.`)
} finally {
  store.close()
}
