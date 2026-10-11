# Project Memory

## Current Phase
Phase 2 portfolio UI: the static Fieldwork storefront is implemented; define commerce behavior before adding backend persistence.

## Completed in the repository
- Documented the deployed-intent architecture from the current Terraform and application code.
- Added maintenance-request validation and sanitized API errors.
- Added standard-library unit tests for API request handling and the health-score function.
- Added the portfolio commerce roadmap and updated the work backlog.
- Added the static Fieldwork storefront, local catalog search/filtering, cart, and simulated checkout.
- Added the current shadcn/ui Vite setup and local Button, Badge, Input, and Card primitives.
- Kept the CloudOps dashboard accessible and added its health-score card and visible API connection error.
- Replaced the error-boundary stack trace with a safe recovery screen.
- Removed stale hard-coded browser/load-test IPs and reduced the load-test ramp defaults.

## Owner-run AWS verification still required
- Apply infrastructure changes only after reviewing the Terraform plan.
- Verify Cognito JWT behavior, CORS, and the current API configuration in AWS.
- Verify recovery flows and actual alert behavior in a staging/demo deployment.
- No AWS resource changes or deployment were performed as part of the repository work.

## Current technical follow-up
- Run backend tests and the frontend build/lint after changes.
- Add storefront component tests.
- Add product detail routes and choose product type, authorization, persistence, and order access patterns.
- Complete origin security decisions for CloudFront and EC2.
- Choose commerce product type, access patterns, and data store before implementing commerce APIs.

## Owner-run AWS work
- Work through `docs/AWS_CONSOLE_BATCHES.md` one batch at a time. The project owner makes all Console changes; use AWS Core for read-only verification after each batch.
- Do not apply Terraform or deploy changes on the owner's behalf.
