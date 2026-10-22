# Architectural Decision Records

## ADR 12: Opt-in guarded recovery of a stopped Store API

**Decision (2026-10-17):** Extend actual Store API health monitoring with an opt-in asynchronous SSM workflow. Conditional DynamoDB versions reserve dispatches; cooldowns and a three-command budget bound attempts. On EC2, a fixed locked script starts only an enabled inactive/failed Store API. The idempotent start does not interrupt an API that became active concurrently. Read the command outcome later and require the real proxy health check before reporting verified recovery.

**Reason:** The user asked for targeted application recovery. Systemd already handles ordinary process crashes. A failed proxy probe does not justify restarting an active Node service or Nginx; ambiguous SSM outcomes must not create repeated root commands.

**Tradeoffs:** Recovery takes scheduled checks, not an immediate synchronous action. Uncertain dispatch/results require review. Application maintenance requires disabling the explicit recovery flag; the existing alarm-only Maintenance toggle does not pause this workflow. Dependency/hung-process repair and Nginx/network failures remain manual follow-up. EC2 health checks are alert-only; no instance reboot is selected.

**Status:** Prepared and verified locally with 47 Lambda tests, including seven simulated shell scenarios. ZIP is owner-uploadable; live recovery remains disabled until `APP_RECOVERY_ENABLED=true` is explicitly set. Deployment and outage validation remain owner-run; see `STORE_API_RECOVERY.md`.

## ADR 11: Batched Store API metrics using the EC2 role

**Decision (2026-10-17):** Publish opt-in minute batches of aggregate Store API requests, 4xx/5xx counts, collection duration and response duration to `Fieldwork/StoreApi` through the AWS SDK. Keep fixed Service/InstanceId dimensions. Read them through the existing protected CloudOps status endpoint and display measured averages and collection gaps.

**Reason:** The user requested application-specific monitoring while CloudFront verification is pending. Direct batching reuses the instance role and preserves the existing CloudWatch Agent configuration. It avoids an extra StatsD listener or log-forwarder deployment for this first iteration.

**Tradeoffs:** Five custom metric series and read/write requests can incur charges. Minute aggregation and warm-Lambda caching add reporting delay. This is API activity, not unique-user tracking or browser latency. Failed publishing leaves missing intervals. No application remediation or error-rate alarms are enabled by this preparation.

**Status:** Implemented/tested locally; owner deployment and live metric validation remain pending in `STORE_API_MONITORING.md`.

## ADR 1: Lambda and API Gateway for the dashboard API

**Decision:** Use AWS Lambda behind API Gateway rather than a persistent Flask/Django service on EC2.

**Reason:** Keeps the API event-driven and reduces the need to operate a second long-running server. It does not guarantee zero cost.

**Tradeoffs:** Cold starts and service-specific configuration; debugging spans API Gateway, Lambda, and AWS services.

**Status:** Implemented.

## ADR 2: Nginx on EC2 for the frontend origin

**Original decision:** Host the React SPA on Nginx on the EC2 instance and access it by its public IP.

**Current implementation:** The deployment script stages build assets in S3 and syncs them to Nginx. CloudFront is now the public viewer endpoint and redirects viewers to HTTPS. CloudFront still uses HTTP to the EC2 origin, and direct EC2 HTTP access remains possible.

**Tradeoffs:** The app still depends on a single EC2 origin and has an unencrypted origin hop. The original direct-IP-only approach is superseded.

## ADR 3: DynamoDB for operational state and audit records

**Decision:** Use DynamoDB for Health Manager state and operational audit events.

**Reason:** The current access patterns are key-based and the service integrates with Lambda.

**Tradeoffs:** The schema must fit known access patterns; flexible relational queries are not its strength. This decision applies to CloudOps state/auditing, not automatically to future commerce data. Cost depends on account and usage.

**Status:** Implemented.

## ADR 4: Event-driven recovery and scheduled health checks

**Decision:** Use CloudWatch alarms with SNS for CPU/memory remediation, EventBridge for lifecycle logging, and scheduled Lambda functions for health checks and trend analysis.

**Reason:** Separates alarm-based response, periodic health checks, lifecycle auditing, and heuristic pre-alerts.

**Tradeoffs:** These are distinct paths and should be tested separately. The alarm named `self-healing-auto-recovery` currently notifies SNS; the Health Manager performs reboot attempts after detecting EC2 health problems.

**Status:** Implemented in Terraform; owner-run AWS verification is pending.

## ADR 5: Cognito authentication for dashboard API routes

**Decision:** Use a Cognito User Pool and API Gateway JWT authorizer for the status and maintenance routes.

**Reason:** Require signed-in operators before exposing telemetry or allowing maintenance changes.

**Tradeoffs:** The application must handle login/session behavior, and live authorizer configuration must be verified after deployment. Admin roles for future commerce mutations require additional backend authorization checks.

**Status:** Configured in Terraform; owner-run AWS verification is pending.

## ADR 6: DynamoDB is the commerce data store

**Decision:** Use a dedicated DynamoDB table as the source of truth for the physical-product catalog, inventory, and customer orders. Keep commerce records separate from the existing CloudOps operational state and audit tables.

**Reason:** The Storefront has known key-based access patterns and needs durable order history, customer ownership queries, persistent idempotency, and atomic inventory acceptance. DynamoDB supports these without a database server or VPC.

**Tradeoffs:** Access patterns and indexes must be designed up front, and flexible joins or ad-hoc relational reporting would require a different data model. Capacity, storage, indexes, backups, and data transfer can incur charges.

**Status:** Implemented locally. The Store API defaults to the DynamoDB repository with persistent idempotency, conditional writes, and atomic acceptance/inventory transactions. Owner-run table creation, catalog seed, and live restart verification remain pending until AWS project verification completes.

## ADR 7: Exactly two frontends with distinct user experiences

The separate-pool authentication part of this original decision is superseded by ADR 10 at the user's request. The two frontend applications remain.

**Decision:** Keep exactly two frontends: the Fieldwork Storefront and the CloudOps operations dashboard. The Storefront includes customer sign-in, browsing and cart flows, saved order history, and a separate admin sign-in experience and interface. Use a Storefront Cognito user pool with an admin authorization group, separate from the existing CloudOps operator pool. Do not collect payment details or process payments in this scope.

**Reason:** Customers and store administrators use one commercial application with different permissions; CloudOps operators remain a separate audience and trust boundary.

**Tradeoffs:** Storefront APIs must validate Cognito tokens, enforce customer order ownership, and require the admin group for administrative operations. Separate deployment origins and Cognito callback updates are required. The current storefront has no persistent commerce API.

**Status:** Frontend split, Storefront Cognito integration code, customer order-history, and admin order-management pages are implemented locally. Owner-run Cognito configuration and live customer/admin authorization tests are complete; durable repository code is ready and awaits the owner-created DynamoDB table and live restart proof.

## ADR 8: Customers can cancel pending orders; admins control other order changes

**Decision:** A submitted order starts in `REQUESTED`. A customer can cancel only their own `REQUESTED` order from the Storefront account area. Customers cannot edit orders. Admins handle other order changes and decide whether to accept an order. Inventory is not decremented when an order is requested; acceptance must recheck availability and update inventory and order state atomically. No payment step is included.

**Reason:** Customers can withdraw an unaccepted request while administrators retain control of fulfillment decisions and inventory changes.

**Tradeoffs:** The API must enforce ownership and state transitions on every request. Concurrent acceptances need transaction conflict handling so inventory cannot be oversold.

**Status:** The Store API rule contract and Storefront customer/admin controls are implemented locally. Durable DynamoDB persistence awaits the owner-created table and live proof.

## ADR 9: Defer cache, load balancing, and automatic scaling until justified

**Decision:** Do not add Redis/Valkey, an Application Load Balancer, or an EC2 Auto Scaling Group to the initial commerce implementation. Reconsider each service if measured performance or an explicit availability requirement justifies it. If EC2-based multi-AZ serving is later selected, use an ALB for routing and health checks and an Auto Scaling Group for instance replacement and scaling.

**Reason:** The current project is small, and the existing CloudOps dashboard already provides a foundation for observing its resources. Additional services should address measured needs.

**Tradeoffs:** Deferring these services avoids their hourly, request, and networking costs now. A single-instance API would have limited availability and scaling until a later architecture change.

**Status:** Deferred pending workload and availability evidence.

## ADR 10: Reuse the Storefront administrator sign-in for CloudOps

**Decision (2026-10-16, user-requested):** Use the existing Storefront Cognito pool and public app client as the shared identity for both applications. An administrator who opens CloudOps from the Storefront continues the existing managed-login session through an automatic `prompt=none` authorization-code/PKCE flow. No second password form is shown while that Cognito session is valid.

**Reason:** The user wants Storefront administrators to open the operations dashboard directly after their initial admin sign-in. Separate identity pools required a second operator login and duplicate user/group setup.

**Controls:** Keep two frontend origins and their separate session storage. Navigation carries only an `sso=storefront` intent, never tokens or credentials. CloudOps receives its own tokens from Cognito and still requires server approval and the exact `store-admin` group before showing data or controls. Customers cannot gain access by opening the URL or adding the SSO marker. An expired Cognito session returns to the Storefront login rather than making the dashboard public.

**Tradeoffs and owner migration:** Approved Storefront administrators also become CloudOps operators. The owner must deploy the Lambda group checks before changing the API JWT authorizer to trust the Storefront pool/client, add CloudOps callback/logout URLs to the existing Storefront app client, and deploy the frontend changes. The legacy CloudOps pool remains intact; no identity resources are deleted or changed by the assistant. The previous group setup in that pool is not the identity source for this new flow.

**Status:** Implemented locally; 29 mocked browser scenarios, 20 backend tests, both frontend builds/type checks, and lint passed (only the existing four component-export warnings). Terraform CLI was unavailable for validation. AWS activation is owner-run and still pending; see `CLOUDOPS_SSO_SETUP.md`.
