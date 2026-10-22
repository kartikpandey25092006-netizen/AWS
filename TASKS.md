# Backlog

The current architecture and security posture are described in `docs/ARCHITECTURE.md` and `docs/SECURITY.md`. The broader portfolio product plan is in `docs/PRODUCT_ROADMAP.md`.

## P0: Verify and harden the existing CloudOps product

- **Health Manager command hardening (2026-10-18):** Owner saved an instance-scoped SSM policy and verified a Store API recovery. Prepared a parameter-free custom SSM Command document, Lambda package that invokes it without shell parameters, and matching Terraform/IAM changes. The current live function and role still use `AWS-RunShellScript` until the owner deploys the prepared changes. Deployment instructions and safe ordering are in `docs/STORE_API_RECOVERY.md`.

- **Health Manager EC2 alert-only (2026-10-18):** Owner chose to remove automatic EC2 reboot behavior and unused `dynamodb:UpdateItem`, while preserving guarded Store API recovery. Updated local handler, Terraform permissions, and exact IAM JSON. Upload `store-api-alert-only-restricted-recovery-2026-10-18.zip`, then update the live role to match `lambda/health_manager_inline_policy_alert_only.json`. AWS connector operation was unavailable; live IAM changes remain pending owner console edit.

- **TASK-001: Verify Cognito authorization in AWS**
  - **Code status:** Cognito JWT authorization is configured on both API routes in Terraform.
  - **Owner action:** Apply only after reviewing a Terraform plan, then verify as an unauthenticated and authenticated user.
  - **Acceptance:** No token receives 401/403; a valid authorized token can read status and change maintenance mode.

- **TASK-002: Validate API requests and avoid leaking errors**
  - **Status:** Implemented in `lambda/api.py`; local unit tests added.
  - **Acceptance:** Malformed JSON, missing/wrong-type `maintenance`, unsupported methods, and unknown paths return safe client errors; internal exception text is not returned.

- **TASK-003: Confirm API CORS and origin exposure**
  - **Code status:** API Gateway allows the CloudFront origin and `http://localhost:5173`, matching Vite's default dev port.
  - **Owner action:** Verify live browser behavior; decide whether to remove local development origin in deployed configuration and whether to restrict direct EC2 access.

## P1: Complete and polish the CloudOps dashboard

- **TASK-004: Show the API health score in the dashboard**
  - **Status:** Implemented locally as an overall score/grade card. Verify with live API data after deployment.

- **TASK-005: Add visible loading, error, and empty states**
  - **Status:** Implemented a visible connection error and empty audit state. Review interaction in browser.

- **TASK-006: Add frontend tests and split `App.tsx` into components**
  - Add Vitest and React Testing Library after confirming package installation is available.
  - Keep existing dashboard behavior and styles while extracting focused components.

- **TASK-007: Test actual recovery paths in a staging deployment**
  - Validate CPU alarm to SNS to remediation Lambda to SSM.
  - Validate Health Manager EC2 checks and application `/health` recovery separately.
  - Confirm lifecycle records and recovery state in AWS.
  - **Read-only check (2026-10-17):** Live CPU/memory alarms are OK with actions enabled and target SNS; SNS has a confirmed Lambda subscription, EventBridge targets the remediation Lambda, and SSM reports the EC2 instance online. Four older audit entries exist for the instance, but none are within the API's 24-hour log window. No remediation Lambda invocations appeared in the last 14 days. A fresh alarm-to-recovery run remains unverified and requires an owner-run staging exercise.
  - **Dashboard check (2026-10-17):** Fixed dark-card text contrast and clarified the 24-hour empty incident message. Browser access smoke checks, 20 Lambda API unit tests, CloudOps build, and frontend lint pass. The Active Protections list remains static and should be backed by live component status before it is treated as a health assertion.

## P2: Build the portfolio commerce experience

See `docs/PRODUCT_ROADMAP.md` for phases, acceptance checks, and the user-led workflow.

- **TASK-008: Decide the store scope and product type**
  - Choose physical, digital, or demo-only products; define the customer and administrator flows.
- **TASK-009: Add persistent catalog and product detail routes**
  - **Status:** A static storefront and local filters/search are implemented; product detail routes and backend catalog are pending.
- **TASK-010: Add persistent cart and retry-safe simulated orders**
  - **Status:** Browser-local cart and simulated confirmation exist; no order is saved.
- **TASK-011: Add customer order history and an admin order/product view**
  - **Navigation update (2026-10-16):** Added separate Customer sign in and Admin sign in actions in desktop/mobile navigation and the footer. Each uses the existing Cognito flow and returns to its corresponding orders page; customers can switch to an administrator login from the admin access gate. Product management remains pending.
  - **Admin login restriction (2026-10-16):** Admin sign-in intent is preserved through OIDC state. The Store API must verify the access token's exact `store-admin` group before the app accepts the session; rejection clears the attempted session. AWS group membership and deployment remain owner-run.
  - **CloudOps access restriction (2026-10-16):** CloudOps links are admin-only. The separate dashboard requires exact access-token group membership and server approval before fetching metrics or displaying controls. Lambda group authorization and a protected session route are implemented locally; owner AWS configuration/deployment steps are in `docs/CLOUDOPS_ADMIN_ACCESS.md`.
  - **Shared admin sign-in (2026-10-16, ADR 10):** CloudOps now automatically continues a Storefront administrator session with no-prompt Cognito SSO and PKCE. Header/footer/order-page links carry only the SSO intent; customers and failed sessions stay blocked. Local settings use the Storefront pool/client. All 29 browser checks, 20 backend tests, and both frontend builds passed. Owner activation (deploy group checks first, register callbacks, migrate API trust) remains pending in `docs/CLOUDOPS_SSO_SETUP.md`.
  - **Live activation status (2026-10-16):** Shared Storefront client now has port 5174 callbacks/logout. Rebuilt and source-verified `lambda/api.zip` for owner upload. Active CloudOps API still needs owner deployment of the Lambda group checks, payload format 2.0, JWT-protected `GET /api/session`, CloudOps CORS origins, and shared Storefront issuer/audience. Read-only AWS inspection confirmed these gaps; no AWS writes were made.
  - **Live Lambda recheck (2026-10-17):** A successful code update did not install the prepared group checks: direct unauthenticated `/api/session` probe returned 200, rather than 401. A uniquely named, source-verified `lambda/cloudops-admin-api-2026-10-17.zip` is ready for owner upload. Keep the API authorizer on its legacy pool until the live Lambda denies this probe.
  - **Correct Lambda upload verified (2026-10-17):** Owner uploaded the uniquely named zip. Live hash matches, and direct probes returned 401 without claims, 403 for customer group, and 200 for exact admin group. API Gateway owner steps remain: integration payload 2.0, protected session route, port 5174 CORS, and shared issuer/audience.
  - **Integration update verified (2026-10-17):** Owner changed active integration `aa2nr2k` to payload 2.0; read-only API check confirmed it. Next owner steps: protected `GET /api/session`, port 5174 CORS, shared Storefront issuer/audience.
  - **Session route and authorizer verified (2026-10-17):** Owner added GET `/api/session` and changed `pj4ccy` to the shared Storefront pool/client. Route uses JWT authorization but still lacks integration target; CORS still lacks port 5174 origins.
  - **Session integration verified (2026-10-17):** Owner attached `aa2nr2k` to GET `/api/session`; live unauthenticated request returned HTTP 401. Port 5174 CORS origins remain the next owner step.
  - **CORS and local endpoints verified (2026-10-17):** Owner added localhost/127.0.0.1 port 5174 origins. Preflight requests returned 204 with matching allow-origin and required headers/methods; local Storefront, CloudOps, and Store API returned 200. Next: real admin SSO and customer direct-access browser checks.
- **TASK-012: Connect commerce service health and order activity to CloudOps monitoring**
  - **Actual health verified and recovery prepared (2026-10-17):** Owner uploaded monitor-only code and showed the DynamoDB record HEALTHY at `/store-api/health` with checked_at `2026-10-17T07:36:44.196981+00:00`. Implemented opt-in guarded Store API start through asynchronous SSM, version-conditional dispatch, 120-second cooldown, three-attempt cap and real command/HTTP verification. Existing EC2 recovery selection remains. All 47 Lambda tests pass, including seven Bash simulations with stubbed system commands. Prepared `lambda/store-api-targeted-recovery-2026-10-17.zip`; owner upload, explicit enable flag and live outage test are still pending. See `docs/STORE_API_RECOVERY.md`.
  - **Live application metrics and bounded check (2026-10-17, owner evidence):** Owner activated Store API v3 and uploaded the application-metrics Lambda. CloudWatch screenshots show the five metric names on the monitored EC2 dimensions, request/client-error samples, and average duration 34.47 ms. Admin CloudOps displayed a fresh single request at 29.38 ms, then the bounded 20-request check showed 20 requests, 4/min over five minutes, average 6.75 ms and no errors. CPU was 0.9%, memory 31.2%; no causal resource increase or capacity guarantee is inferred. Public Storefront delivery still awaits CloudFront verification.
  - **Accurate application health prepared (2026-10-17):** Changed Health Manager from static `/health` to bounded JSON-verified `/store-api/health`. App checks now observe/audit transitions without SSM restarts; existing EC2 recovery selection is retained. Verified health-monitor ZIP is ready for owner upload; all 34 Lambda tests passed. Live deployment/record verification remains pending in `docs/STORE_API_HEALTH.md`.
  - **Application telemetry prepared (2026-10-17):** Added opt-in, asynchronous minute-batch request/4xx/5xx/latency metrics using the EC2 role, fixed Service/InstanceId dimensions, collection evidence and honest partial/stale/no-data display. The existing admin-protected status API reads the five-minute window with a warm cache. All 15 Store API tests, 28 Lambda tests and isolated browser access/state checks passed; CloudOps build passed and lint has only existing warnings. Verified Store API v3 and application-metrics Lambda ZIPs are prepared; no AWS writes occurred. Owner deployment and real traffic verification remain in `docs/STORE_API_MONITORING.md`.
  - **Storefront traffic telemetry (2026-10-17):** Traced the current local Store API URL to `127.0.0.1:3100`, separate from the monitored EC2 instance. Verified CloudOps CPU samples and discovered the CloudWatch Agent's memory metric uses the `host` dimension, while the deployed API and high-memory alarm request `InstanceId`. Prepared a corrected local CloudOps API package, an honest `NO DATA` UI state, and a bounded Store API load pilot. Owner deployment order and the still-unresolved memory alarm are in `docs/STOREFRONT_CLOUDOPS_METRICS.md`.
  - **Memory activation (2026-10-17):** Owner uploaded the CloudOps Lambda package; read-only verification confirmed its code hash and a matching live CloudWatch memory sample of 25.4%. Store API is still local to the developer computer. Prepared `fieldwork-store-api-release-v2.zip` from the current source after finding v1 stale; all seven packaged files match and 11 Store API tests passed. Owner upload and EC2 installation remain pending.
  - **EC2 Store API activation (2026-10-17):** Owner uploaded v2; S3 size and checksum matched the local package. Owner installed Node.js 22, dependencies, environment file, dedicated service user, and systemd service on the monitored EC2 instance. Terminal output confirms the service is active and enabled, direct health/catalog return 200, and the Nginx `/store-api/api/products` route returns all six catalog products. HTTPS delivery and Storefront browser configuration remain pending. Catalog success alone does not establish order flows or application-specific monitoring.

## P3: Improve delivery and operations

- **Storefront delivery preparation (2026-10-17):** Owner created `fieldwork-storefront-325381793128`. CloudFront creation was rejected pending verification; owner submitted a support case. Prepared a production build and verified 11-file ZIP using same-origin `/store-api`; production CloudOps links await the separate deployed dashboard URL. TypeScript/build passed, lint has four existing warnings, and a headless browser rendered a mocked catalog via the intended API path. See `docs/STOREFRONT_RELEASE.md` for owner upload and remaining HTTPS/authentication gates.

- **TASK-013: Add repeatable frontend and backend CI checks**
  - Run lint, unit tests, and frontend build on pull requests.
- **TASK-014: Improve origin security and custom-domain support**
  - Decide on CloudFront-to-origin HTTPS and block public bypass to the EC2 origin.
- **TASK-015: Add budgets and environment teardown instructions**
  - Document actual resources and estimate/monitor costs before enabling optional features.

See [`docs/AWS_CONSOLE_BATCHES.md`](docs/AWS_CONSOLE_BATCHES.md) for the owner-run Console sequence and AWS Core verification points.

- [x] Owner verified controlled Store API recovery and dashboard success on 2026-10-17; corrected local recovery request status and trigger labels. Frontend refresh/deployment confirmation pending; tests/build not run.

- [x] Prepare memory alert safety package and dashboard Attention required status; owner upload pending. No tests/build run. Legacy CPU remediation verification remains outstanding.

- [x] Owner verified simulated memory alert handler and dashboard. Prepared CPU attention-only resource alert package; owner upload and simulation pending; no tests run.

- [x] Static security review recorded in docs/SECURITY_REVIEW_2026-10-18.md; findings prepared, no security fixes applied in this review.

- [x] Security step 1: remove remediation unknown-alarm command fallback locally; owner upload pending. Tests not run; IAM cleanup remains separate.

- [x] Security step 2 local admin PATCH logger fix and v4 release package prepared; tests and live deployment pending.

- [x] Remove unused remediation SSMCommand block from local Terraform; owner console policy edit pending. Health Manager role unchanged.

- [x] Prepare SNS publish SourceAccount and exact CPU/memory SourceArn restrictions locally; owner save and delivery verification pending.

- [x] Prepare scoped Health Manager reboot and SendCommand policy; owner save and verification pending.
