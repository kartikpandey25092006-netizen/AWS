# DynamoDB setup for durable Storefront orders

The project owner performs every AWS Console, CLI, Terraform, and deployment action in this guide. The Store API uses the AWS SDK credential provider chain and never stores AWS access keys or database passwords.

## Decision

- Selected Region: `us-east-1`.
- Table name: `fieldwork-store-commerce`.
- Billing mode: on-demand for the initial low and unpredictable development workload.
- Encryption: AWS owned key.
- Deletion protection: enabled.
- Point-in-time recovery: optional until the owner reviews its additional cost.
- The existing CloudOps audit and recovery-state tables remain separate.

The commerce table stores products, inventory, orders, shipping addresses, status transitions, and customer-scoped idempotency records. Order items are embedded in each order because the API limits an order to 20 distinct products, keeping an order well below DynamoDB's item-size limit.

## Owner step 1: wait for project verification

AWS reported that project verification is in progress. Do not create the table until the AWS Management Console stops showing that message. If verification is still pending after the stated two-day window, use the AWS Support link from the error message.

Before creating resources, check spend status in **AWS Settings → Billing**. Only the project owner can change the spend limit.

## Owner step 2: create the commerce table

1. Open the AWS Management Console and confirm the selected Region is **US East (N. Virginia) — us-east-1**.
2. Open **DynamoDB → Tables → Create table**.
3. Enter table name `fieldwork-store-commerce`.
4. Set partition key `pk` with type **String**.
5. Set sort key `sk` with type **String**.
6. Select **Customize settings** and choose **On-demand** capacity.
7. Keep the AWS owned encryption key.
8. Enable deletion protection.
9. Create these global secondary indexes with **All attributes** projected:

   | Index | Partition key | Sort key |
   |---|---|---|
   | `CustomerOrdersIndex` | `customerKey` (String) | `customerOrderKey` (String) |
   | `EntityIndex` | `entityType` (String) | `entitySortKey` (String) |

10. Add tags `Project=CloudOps` and `Environment=Development` if offered.
11. Create the table and wait until the table and both indexes show **Active**.

Do not reuse the existing CloudOps audit or state tables. The Store API depends on the exact table and index key names above.

## Owner step 3: seed the catalog

After the table is active, open PowerShell:

```powershell
cd C:\Users\karti\OneDrive\Desktop\AWS_MAIN\CloudOps-main\services\store-api

$env:AWS_PROFILE="kartik2509"
$env:AWS_REGION="us-east-1"
$env:STORE_DYNAMODB_TABLE="fieldwork-store-commerce"

npm run seed:dynamodb
```

Expected output:

```text
DynamoDB catalog is ready in fieldwork-store-commerce.
```

The seed command inserts missing products and leaves existing product records and stock unchanged.

## Owner step 4: verify persistence

In the same PowerShell session:

```powershell
npm run verify:dynamodb
```

Expected output resembles:

```text
DynamoDB persistence verified for order <uuid>. Test order was cancelled.
```

This command writes an order, closes the first SDK client, opens a new client, retrieves the same order, verifies persistent idempotency, and cancels the test order.

## Owner step 5: start the local Store API

```powershell
$env:STORE_DATABASE="dynamodb"
$env:STORE_COGNITO_USER_POOL_ID="us-east-1_vP8QkD0ry"
$env:STORE_COGNITO_APP_CLIENT_ID="5oumcah9a3gtomb24unutar9d9"

npm start
```

Expected output:

```text
Store API listening on port 3100 with dynamodb storage
```

Start the Storefront separately, submit an order as the customer, restart only the API, and confirm the same order remains under **My orders**.

## Runtime IAM permissions

The deployed Store API uses its EC2 instance role and the default AWS credential provider chain. Grant access only to the commerce table and its indexes. The role needs these DynamoDB actions:

- `dynamodb:DescribeTable`
- `dynamodb:GetItem`
- `dynamodb:BatchGetItem`
- `dynamodb:Query`
- `dynamodb:PutItem`
- `dynamodb:UpdateItem`

Scope table operations to the table ARN and query access to both the table ARN and `${tableArn}/index/*`. The browser never receives these permissions and never connects directly to DynamoDB.

For DynamoDB transactions, IAM evaluates the permissions for the underlying `Put`, `Update`, `Delete`, and `ConditionCheck` operations. This Store API transaction contains only `Put` and `Update` actions, so the role does not need delete or standalone condition-check permissions.
