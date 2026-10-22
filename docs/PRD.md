# Product Requirements Document

## Product purpose

This is a CloudOps portfolio project that demonstrates monitoring, recovery attempts, audit records, and an operator dashboard for a small web service. It also contains a planned physical-product Storefront so CloudOps can observe a more realistic application. The commerce scope is tracked in `PRODUCT_ROADMAP.md` and `IMPLEMENTATION_BATCHES.md`.

AWS charges depend on account, region, usage, and current pricing. The project does not guarantee that deployment is free.

## Problem being addressed

Basic infrastructure and application failures can require manual investigation and prolong downtime. The project demonstrates automated detection and recovery workflows, then gives an operator visibility into metrics and recorded actions.

## Users

- Students and developers learning cloud operations and SRE patterns.
- Operators inspecting the state and recovery behavior of the demo service.
- Storefront customers and administrators as the commerce batches are completed.

## Current functionality

- CloudWatch metrics and alarms for CPU, memory, and EC2 health checks.
- SNS, Lambda, and SSM based Nginx remediation for CPU and memory alarms.
- A scheduled Health Manager that checks EC2 status and the Store API health endpoint, reports EC2 status changes without rebooting, and can perform a guarded Store API start through a fixed SSM document.
- EventBridge lifecycle logging and periodic CPU/memory trend analysis, with optional Discord alerts.
- Cognito sign-in and API Gateway JWT authorization for dashboard API routes.
- A React dashboard for uptime, CPU and memory graphs, audit events, recovery state, and maintenance mode.
- A Fieldwork Storefront UI with API-backed product cards, search, category filters, browser-session cart state, customer order history/cancellation, and admin order-management routes.
- A local Store API for catalog access, requested orders, customer cancellation, and administrator acceptance. Its DynamoDB repository and controlled catalog seed are implemented; live durability awaits the owner-created commerce table and restart proof.
- DynamoDB audit/state tables and S3 audit objects.

## Current limitations

- Single EC2 web origin; this is not a production high-availability design.
- CloudFront uses HTTPS for viewers but currently connects to the EC2 origin over HTTP; the EC2 host also allows direct HTTP access.
- The Health Manager and alarm paths are separate. The alarm named auto-recovery currently notifies SNS; EC2 status checks are alert-only. The Health Manager's only recovery path is a guarded Store API start.
- The API computes a custom health score, but the dashboard does not yet display it.
- Storefront Cognito customer and administrator flows are configured and locally verified. The DynamoDB persistence code is ready, while live durability waits for AWS project verification and owner-created resources. Payment processing and newsletter storage are out of scope.

## Success criteria

- Local unit tests cover maintenance input validation, safe error responses, and health-score behavior.
- The frontend builds and passes lint checks.
- In a test deployment, operators can verify authorization, alarms, remediation attempts, and audit records.
- The portfolio demo clearly explains what is implemented, what is simulated, and what remains unverified.
