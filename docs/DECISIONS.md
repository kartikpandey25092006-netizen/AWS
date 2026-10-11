# Architectural Decision Records

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

## ADR 6: Commerce data store is not yet selected

**Decision:** Do not extend the operational DynamoDB tables for commerce until product type, user flows, and query patterns are defined.

**Reason:** Orders, inventory, product browsing, and customer order history may need different access patterns from operational logs.

**Status:** Pending Phase 1 of `PRODUCT_ROADMAP.md`.

## ADR 7: Static storefront as the portfolio UI milestone

**Decision:** Add a static Fieldwork storefront using local demo products, browser-local cart state, and a simulated checkout. Keep the CloudOps dashboard available as a separate operator view. Use the current shadcn/ui Vite approach for shared storefront primitives.

**Reason:** Demonstrate a broader customer-facing application without claiming that a commerce backend, real payments, inventory, or saved customer data exists.

**Tradeoffs:** Orders disappear on refresh and no customer/admin authorization can be demonstrated until a backend is designed. The product type and storage remain open decisions.

**Status:** Frontend milestone implemented; backend decisions pending.
