# Backlog

The current architecture and security posture are described in `docs/ARCHITECTURE.md` and `docs/SECURITY.md`. The broader portfolio product plan is in `docs/PRODUCT_ROADMAP.md`.

## P0: Verify and harden the existing CloudOps product

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

## P2: Build the portfolio commerce experience

See `docs/PRODUCT_ROADMAP.md` for phases, acceptance checks, and the user-led workflow.

- **TASK-008: Decide the store scope and product type**
  - Choose physical, digital, or demo-only products; define the customer and administrator flows.
- **TASK-009: Add persistent catalog and product detail routes**
  - **Status:** A static storefront and local filters/search are implemented; product detail routes and backend catalog are pending.
- **TASK-010: Add persistent cart and retry-safe simulated orders**
  - **Status:** Browser-local cart and simulated confirmation exist; no order is saved.
- **TASK-011: Add customer order history and an admin order/product view**
- **TASK-012: Connect commerce service health and order activity to CloudOps monitoring**

## P3: Improve delivery and operations

- **TASK-013: Add repeatable frontend and backend CI checks**
  - Run lint, unit tests, and frontend build on pull requests.
- **TASK-014: Improve origin security and custom-domain support**
  - Decide on CloudFront-to-origin HTTPS and block public bypass to the EC2 origin.
- **TASK-015: Add budgets and environment teardown instructions**
  - Document actual resources and estimate/monitor costs before enabling optional features.

See [`docs/AWS_CONSOLE_BATCHES.md`](docs/AWS_CONSOLE_BATCHES.md) for the owner-run Console sequence and AWS Core verification points.
