# Product Requirements Document

## Product purpose

This is a CloudOps portfolio project that demonstrates monitoring, recovery attempts, audit records, and an operator dashboard for a small web service. A future portfolio extension may add a demo storefront so the CloudOps system observes a more realistic application. The commerce scope is tracked in `PRODUCT_ROADMAP.md`.

AWS charges depend on account, region, usage, and current pricing. The project does not guarantee that deployment is free.

## Problem being addressed

Basic infrastructure and application failures can require manual investigation and prolong downtime. The project demonstrates automated detection and recovery workflows, then gives an operator visibility into metrics and recorded actions.

## Users

- Students and developers learning cloud operations and SRE patterns.
- Operators inspecting the state and recovery behavior of the demo service.
- Future demo-store customers and administrators, if the commerce roadmap is implemented.

## Current functionality

- CloudWatch metrics and alarms for CPU, memory, and EC2 health checks.
- SNS, Lambda, and SSM based Nginx remediation for CPU and memory alarms.
- A scheduled Health Manager that checks EC2 status and the application health endpoint, then can attempt an EC2 reboot or Nginx restart.
- EventBridge lifecycle logging and periodic CPU/memory trend analysis, with optional Discord alerts.
- Cognito sign-in and API Gateway JWT authorization for dashboard API routes.
- A React dashboard for uptime, CPU and memory graphs, audit events, recovery state, and maintenance mode.
- A Fieldwork demo storefront with static product cards, search, category filters, browser-local cart state, and simulated checkout. No commerce data is persisted.
- DynamoDB audit/state tables and S3 audit objects.

## Current limitations

- Single EC2 web origin; this is not a production high-availability design.
- CloudFront uses HTTPS for viewers but currently connects to the EC2 origin over HTTP; the EC2 host also allows direct HTTP access.
- The Health Manager and alarm paths are separate. The alarm called auto-recovery currently notifies SNS; the scheduled Health Manager handles reboot attempts after checking instance health.
- The API computes a custom health score, but the dashboard does not yet display it.
- The storefront is a static portfolio UI. It has no commerce API, persistent cart/orders, inventory, payment processing, or newsletter storage. Checkout is simulated only.

## Success criteria

- Local unit tests cover maintenance input validation, safe error responses, and health-score behavior.
- The frontend builds and passes lint checks.
- In a test deployment, operators can verify authorization, alarms, remediation attempts, and audit records.
- The portfolio demo clearly explains what is implemented, what is simulated, and what remains unverified.
