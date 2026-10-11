# Two-Frontend CloudOps Store Migration

## Target architecture

- Storefront: public Fieldwork commerce site with product browsing, cart, and simulated checkout. It will not collect card data or process real payments.
- CloudOps dashboard: a separate app and origin. Cognito sign-in is required before rendering telemetry or controls; API Gateway validates JWTs on protected API calls.
- Store API: Application Load Balancer in front of an EC2 Auto Scaling Group. Traffic to the API drives the CPU/memory demonstration.
- Commerce data: RDS for PostgreSQL is authoritative for catalog and demo orders. ElastiCache Valkey/Redis-compatible cache contains disposable catalog data and falls back to RDS when unavailable.
- Operations: retain DynamoDB and the audit S3 bucket for CloudOps state and audit data. CloudWatch shows CPU, memory, alarms, ALB traffic, and scaling actions. SSM and Auto Scaling handle recovery.
- Static hosting: each frontend gets its own private S3 bucket and CloudFront distribution.

AWS Console actions, Terraform plans and applies, and deployment remain owner-run. This project work does not change AWS resources.

## Batches

### Batch 0 — Audit (complete)
Confirmed the existing combined SPA, Cognito-protected dashboard API, single EC2 recovery stack, and browser-only storefront cart. The current Terraform has no commerce API, RDS, Redis, ALB, or Auto Scaling Group.

### Batch 1 — Separate the frontends (complete)
Created independent Vite apps at frontend/apps/storefront and frontend/apps/cloudops. Storefront no longer switches into CloudOps. The dashboard fails closed if Cognito configuration is missing and stores OIDC state in tab session storage. The legacy single-origin deploy script is paused. Checks passed: npm run build, npm run lint, npm run test:smoke.

### Batch 2 — Commerce API and rules
Add product, order, health, and simulated-checkout behavior. Calculate prices from server catalog data; validate IDs and quantities; make order creation safe to retry. Never collect payment data. Test API validation, idempotency, and storefront calls.

### Batch 3 — RDS PostgreSQL
Add encrypted PostgreSQL, private subnets/security groups, credentials through Secrets Manager, and schema/seed migrations. Keep commerce records separate from CloudOps DynamoDB records. Test migrations and repository operations locally; format and validate Terraform. Owner reviews and applies.

### Batch 4 — Redis-compatible cache
Add private ElastiCache Valkey for catalog data with TTL and invalidation. PostgreSQL remains authoritative; cache failure falls back to RDS. Test hits, misses, invalidation, and cache-down behavior. Owner reviews and applies.

### Batch 5 — Load balancer and Auto Scaling
Add an ALB, target group, launch template, and multi-AZ EC2 Auto Scaling Group. Instances accept inbound traffic only from the ALB. Scale on sustained CPU and ALB request load; publish memory metrics through CloudWatch Agent. Health-check failures replace unhealthy instances. High CPU should scale out rather than restart a healthy web process. Validate Terraform and bounded load-test scripts; owner reviews and applies.

### Batch 6 — CloudOps fleet monitoring
Show fleet CPU/memory, ALB request/error/latency metrics, alarms, instance counts, and scaling/recovery events in the Cognito-protected dashboard. Test unauthenticated, invalid-token, and valid-token requests, metric aggregation, and UI builds.

### Batch 7 — Separate AWS delivery and security
Add independent private S3 origins and CloudFront distributions. Update Cognito callbacks/logout URLs and API CORS. Deploy each build only to its own bucket and invalidate its own distribution. Review TLS, least privilege, logs, budgets, and teardown. Validate Terraform and inspect the final plan; owner applies.

### Batch 8 — End-to-end demonstration
Run a bounded load test against the Store API and observe CPU/memory, alarm state, ALB targets, Auto Scaling activity, and recovery in CloudOps. Include stop and cleanup steps. Do not expose an unbounded public load endpoint.

## Owner-operated AWS gates

For each infrastructure batch, the owner reviews the Terraform plan, makes the AWS changes, applies, and returns the output or AWS evidence. Do not run Terraform apply, deploy artifacts, or mutate AWS resources from the coding workflow.
