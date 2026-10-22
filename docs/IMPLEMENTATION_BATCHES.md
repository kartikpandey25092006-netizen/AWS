# Two-Frontend CloudOps Store Migration

## Target architecture

- Storefront: one commercial Fieldwork frontend for physical products, with customer sign-in, catalog browsing, cart, saved orders, and a separate admin sign-in experience and interface. There is no payment collection or payment processing in scope.
- CloudOps dashboard: the second frontend, protected by the existing operator Cognito flow. Its API validates JWTs for protected telemetry and controls. Keep Storefront identities and authorization separate from CloudOps operators.
- Shared identity (ADR 10): the dedicated Storefront Cognito pool supplies customer/admin identities, and approved Storefront administrators continue into CloudOps through no-prompt SSO. Customers can access only their own order history and cancel their own `REQUESTED` orders. All admin and CloudOps operations require the exact `store-admin` group and server-side authorization. Owner migration steps are in `CLOUDOPS_SSO_SETUP.md`.
- Store API: provides catalog, cart/order, customer account, and admin operations. Review whether the existing compute can be reused before adding new compute or network services.
- Order and stock rules: new orders begin as `REQUESTED`. Customers may cancel their own requested orders, but cannot edit them. Admins handle other order changes and acceptance. Check stock and atomically decrement it only when an admin accepts an order.
- Commerce data: a dedicated DynamoDB commerce table is the target source of truth for products, inventory, and orders. Keep it separate from the existing CloudOps state and audit tables. The DynamoDB repository, catalog seed command, persistent idempotency records, conditional writes, atomic acceptance transaction, and restart verification command are implemented locally. Live durability is pending the owner-created table.
- Optional services: do not add Redis/Valkey, an ALB, or an Auto Scaling Group in the initial commerce implementation. Reconsider them when measurements or availability requirements justify their costs. If an EC2-based multi-AZ API is later selected, an ALB can route and health-check traffic while an Auto Scaling Group replaces and scales instances.
- Operations: preserve the existing DynamoDB, audit S3, Lambda, API Gateway, Cognito, EC2, and CloudWatch resources where practical. The dashboard should show metrics that are actually available, including EC2 CPU and CloudWatch Agent memory, plus relevant Lambda, API Gateway, DynamoDB, alarms, and recovery events. Display missing telemetry as unavailable rather than zero. Add ALB, scaling, or database metrics only if those services are adopted.
- Static hosting: keep the two frontends independently deployable. Reconcile existing S3 buckets and CloudFront resources before selecting or changing hosting, and use private S3 origins with CloudFront where supported by the final deployment design.

AWS Console actions, Terraform plans and applies, and deployment remain owner-run. This project work does not change AWS resources.

## Batches

### Batch 0 — Audit (complete)
Confirmed the existing combined SPA, Cognito-protected dashboard API, single EC2 recovery stack, and browser-only storefront cart. The current Terraform has no Store API runtime, commerce DynamoDB table, Redis/Valkey, ALB, or Auto Scaling Group.

### Batch 1 — Separate the frontends (complete)
Created independent Vite apps at frontend/apps/storefront and frontend/apps/cloudops. Storefront no longer switches into CloudOps. The dashboard fails closed if Cognito configuration is missing and stores OIDC state in tab session storage. The legacy single-origin deploy script is paused. Checks passed: npm run build, npm run lint, npm run test:smoke.

### Batch 2A — Commerce API rules and contract (complete locally)
The Store API now has public catalog endpoints and protected customer and admin order endpoints. It verifies Storefront Cognito access tokens when the User Pool and application client identifiers are supplied, rejects client supplied prices and identities, makes order creation idempotent, enforces customer ownership, and requires the `store-admin` group for administrative changes. A new order is `REQUESTED`; only its customer can cancel it while requested; acceptance requires a complete address, rechecks stock, and decrements stock once.

The API rule suite uses an isolated in-memory repository. Production startup now requires the DynamoDB repository; memory storage remains an explicit non-production option and must not be used to demonstrate saved-order persistence.

### Batch 2B — Storefront Cognito login, account, and admin pages (complete locally)
The Storefront experience is implemented against the established API contract:

- Add public catalog and cart routes, a customer account route, and an admin order route. The admin route remains part of the Storefront, so the project still has exactly two frontends.
- Add customer sign-in, sign-out, and authenticated-session handling using authorization code flow with PKCE. Browse and add to cart without signing in; require a session to submit an order, see order history, cancel an order, or enter the admin route.
- Replace the hard-coded catalog with `GET /api/products`. Create orders with a new UUID `Idempotency-Key` per checkout attempt and preserve the cart until the API reports success.
- Add a customer account page with `GET /api/orders/me` and a Cancel control only for the signed-in customer's `REQUESTED` orders. Do not provide customer order editing. Explain that an incomplete shipping address prevents admin acceptance.
- Add a distinct admin sign-in entry and an admin order-management page in the same Storefront application. Render it only after client routing sees the `store-admin` group, but retain the API as the authorization authority. Admins can review orders, correct shipping information, update permissible pending order details, and accept orders.
- Attach the Cognito access token to protected Store API calls; implement loading, empty, authentication, authorization, validation, conflict, and unavailable states; keep payments out of the interface.
- Add a tracked `frontend/.env.example` containing only public browser configuration names such as `VITE_STOREFRONT_API_URL`, `VITE_STOREFRONT_COGNITO_AUTHORITY`, and `VITE_STOREFRONT_COGNITO_CLIENT_ID`. Storefront Vite configuration reads its environment from `frontend/`; no secret, token, or AWS credential belongs in a Vite variable.

The frontend uses authorization code flow with PKCE through `react-oidc-context`, keeps OIDC state and tokens in session storage, and sends the access token to protected Store API routes. The `store-admin` claim controls client navigation only; the backend remains the authorization authority. Browser smoke tests pass for the API-backed catalog, unconfigured-auth checkout gate, customer route, admin route, and CloudOps lock. TypeScript builds and lint pass, with only pre-existing Fast Refresh warnings in shared UI primitives. Live customer and administrator authentication is verified in Batch 2C. Order history remains non-durable until Batch 3B.

### Batch 2C — Owner-run Storefront Cognito configuration (complete)
The owner completed the AWS configuration in `us-east-1`; the assistant reviewed the settings and tested the local integration without mutating AWS resources.

- Confirm the selected Region in **AWS Settings → View all projects → Overview → Additional Info → Region** and confirm the project's plan and spend-limit status before creating paid resources.
- Keep the existing dedicated Storefront user pool and its customer sign-up/email verification policy. At the user's later request (ADR 10), use it as the shared admin identity for CloudOps and perform the ordered owner migration in `CLOUDOPS_SSO_SETUP.md`. The legacy CloudOps pool is not automatically deleted.
- Create one public SPA application client with no client secret, authorization-code flow with PKCE, and only the required OIDC scopes. Create a managed-login domain.
- Register exact localhost and final Storefront callback and logout URLs. Do not copy the current CloudOps Terraform client values without reconciling them: that client is for the CloudOps pool and its localhost callback currently uses the Storefront port.
- Create the `store-admin` group and assign only Storefront administrators. The group supports UI routing but never replaces backend authorization.
- Record only non-secret values in the local configuration: User Pool identifier, application client identifier, managed-login authority/domain, and allowed Storefront origin. Do not share passwords, access keys, sessions, or JWTs.

Completion evidence: customer and administrator accounts are confirmed and email-verified; only the administrator belongs to `store-admin`; the public SPA client has no secret and uses authorization-code flow with callback/logout URL `http://localhost:5173/`, scopes `openid email profile`, token revocation, and refresh-token rotation. Live browser tests passed for customer order history without admin navigation and for the administrator order-management route backed by an accepted Cognito access token. Live durability waits for the owner-created DynamoDB commerce table.

### Batch 3A — Store API runtime and exposure decision (decision complete; owner deployment pending)
Reuse the existing Amazon Linux 2023 EC2 instance for the first Store API runtime. Run Node under `systemd` as a dedicated service user on `127.0.0.1:3100`, reverse proxy `/store-api/*` through Nginx, and expose it later through the separate Storefront CloudFront distribution with viewer TLS and API caching disabled. Use exact localhost/deployed Storefront CORS origins, the EC2 instance role for DynamoDB, `journald` plus owner-approved CloudWatch Logs forwarding, and SSM for deployment and rollback. The complete boundary and limitations are recorded in `docs/STORE_API_RUNTIME.md`.

Do not expose DynamoDB to the browser or put AWS credentials in the Storefront. The owner performs the table, IAM, CloudFront, Nginx, `systemd`, and deployment changes after project verification completes. Do not add an ALB or Auto Scaling Group unless the later evaluation shows a concrete availability or traffic need.

### Batch 3B — DynamoDB commerce persistence (implementation complete; owner setup and live proof pending)
The Store API now defaults to a dedicated DynamoDB commerce table so products, inventory, orders, embedded order items, shipping addresses, status transitions, and customer order history persist across API restarts. Commerce records remain separate from CloudOps state and audit records. The local implementation includes AWS SDK v3 clients, a controlled catalog seed, persistent customer-scoped idempotency records, optimistic conditional writes, and an atomic transaction that rechecks and decrements stock while accepting an order.

Use the exact table and index keys in `docs/DYNAMODB_SETUP.md`. Seed the catalog through the controlled owner-run command rather than API startup. Use the EC2 instance role with access limited to the commerce table and indexes. The browser continues to call only the Store API.

The proof of completion remains concrete: after AWS project verification, the owner creates the table and indexes described in `docs/DYNAMODB_SETUP.md`, runs `npm run seed:dynamodb`, and runs `npm run verify:dynamodb`. The owner then creates an order as a signed-in customer, restarts the Store API, and confirms the same order remains in order history.

### Batch 4 — Optional catalog cache evaluation
Do not add a cache by default. First measure catalog latency and DynamoDB activity. If evidence justifies caching, evaluate private ElastiCache Valkey for disposable catalog data with TTL and invalidation; DynamoDB remains authoritative and cache failure must fall back to DynamoDB. Document cost and test hits, misses, invalidation, and cache-down behavior before the owner decides whether to proceed.

### Batch 5 — Optional load balancing and Auto Scaling evaluation
Do not add an ALB or Auto Scaling Group by default. First establish traffic, availability, and recovery requirements and estimate the added hourly and multi-AZ costs. If an EC2-based multi-AZ API is justified, design an ALB, target group, launch template, and Auto Scaling Group. Restrict instance ingress to the ALB security group, publish memory metrics through CloudWatch Agent, and use health checks for replacement. Scale on sustained demand rather than restarting a healthy process. Validate the design and bounded load-test scripts; owner reviews and applies.

### Batch 6 — CloudOps resource monitoring
Show available resource CPU/memory, alarms, Lambda/API Gateway metrics, DynamoDB activity, and recovery events in the Cognito-protected dashboard. Add ALB, Auto Scaling, or commerce database metrics only if those services are adopted. Preserve correct metric dimensions and show absent samples as unavailable. Test unauthenticated, invalid-token, and valid-token requests, metric aggregation, and UI builds.

### Batch 7 — Separate AWS delivery and security
Reconcile existing S3 buckets and CloudFront distributions, then use independent private S3 origins and CloudFront distributions where they fit the verified deployment. Extend Storefront Cognito callback/logout URLs and API CORS only with the exact deployed origin selected in earlier batches. Deploy each build only to its own bucket and invalidate its own distribution. Review TLS, least privilege, logs, budgets, and teardown. Validate Terraform and inspect the final plan; owner applies.

### Batch 8 — End-to-end demonstration
Run bounded end-to-end storefront and API tests and observe the telemetry currently available in CloudOps. If an ALB or Auto Scaling Group is adopted after its evaluation, include target health and scaling activity in the demonstration; otherwise, do not make those resources a prerequisite. Include stop and cleanup steps. Do not expose an unbounded public load endpoint.

## Owner-operated AWS gates

For every batch that needs AWS configuration, the assistant first provides the owner with the exact Console or CLI steps, the expected result, relevant configuration values, security and cost notes, and a test checklist. The owner performs every AWS Console, CLI, Terraform, deployment, and resource action. The assistant reviews the plan, output, or evidence shared by the owner. Do not make AWS configuration changes, apply Terraform, deploy artifacts, or mutate AWS resources from the coding workflow.
