# Architecture

> Batch 1 status: storefront and CloudOps are now separate Vite apps. The live AWS stack remains the earlier single-EC2 design until the owner reviews and applies the later migration batches.

## Current system

The project is a single-instance CloudOps demonstration. Terraform provisions the AWS resources; the frontend is a Vite/React single-page app; Python Lambda functions provide the API, event remediation, periodic health checks, and predictive alerts.

### Frontend and sign-in

- **Framework:** React 19 and TypeScript, built as two independent Vite apps under frontend/apps/storefront and frontend/apps/cloudops.
- **Authentication:** Amazon Cognito User Pool Hosted UI. The browser app is a public OIDC client; it sends its access token as a bearer token to the API.
- **Static hosting:** each app builds independently. The Storefront is served from a private S3 bucket through CloudFront Origin Access Control. CloudOps still has no separate public HTTPS origin.
- **Public delivery:** Storefront CloudFront distribution `EXOWA1YGQR32N` serves `fieldwork-storefront-325381793128` and routes only `/store-api/api/products*` to the EC2 Nginx origin. Viewer requests use HTTPS; the EC2 origin hop is HTTP, and direct public HTTP access to EC2 remains possible.
- **Data refresh:** The dashboard polls `GET /api/status` every 10 seconds. It can select 40-minute, 1-hour, or 24-hour metric ranges.
- **Storefront:** a separate public app that reads the Fieldwork catalog from the Store API and keeps its cart in browser session storage. The live CloudFront homepage and six-product catalog were verified on 2026-10-19. Only the public product-list GET route is currently routed; protected order/admin APIs and Cognito login are not yet verified through CloudFront. Payment processing is out of scope.
- **CloudOps dashboard:** a separate app sharing the Storefront Cognito identity at the user's request. Storefront administrator links trigger no-prompt managed-login SSO with authorization code + PKCE; tokens are not transferred through links. Exact `store-admin` membership and server approval via `/api/session` remain required before showing metrics or controls. The owner must deploy the group checks and migrate the API authorizer/callbacks; see `CLOUDOPS_SSO_SETUP.md` and ADR 10.
- **UI components:** Vite uses Tailwind CSS v4 and shadcn/ui conventions with local Button, Badge, Input, and Card components. Dashboard styles remain in the existing CSS system.

### API and authorization

- API Gateway is an HTTP API with a Cognito JWT authorizer on both `GET /api/status` and `POST /api/maintenance`.
- API Gateway CORS allows the CloudFront origin and `http://localhost:5173` for local Vite development.
- The API Lambda reads EC2 uptime and CloudWatch CPU/memory, queries recent audit events and recovery state from DynamoDB, reads alarm status, and computes a custom weighted health score.
- The maintenance route disables or enables CloudWatch alarm actions. It does not stop the alarms from evaluating or prevent the Health Manager from running.

### Recovery and monitoring paths

1. **CPU or memory alarm:** CloudWatch sends the alarm to the remediation SNS topic. SNS invokes `lambda/main.py`, which sends an SSM command to restart Nginx. For a memory alarm it also attempts to stop stress processes. The function records an audit event and checks whether Nginx is active.
2. **Periodic health manager:** EventBridge invokes `lambda/health_manager.py` every minute. It checks EC2 status and the Store API's `/store-api/health` endpoint. EC2 status is alert-only. Store API recovery can invoke a parameter-free custom SSM Command document that starts only the enabled, inactive or failed Store API service and verifies loopback health; the Lambda cannot supply shell commands to the document. State, cooldowns, and command results are tracked in DynamoDB.
3. **Predictive monitoring:** EventBridge invokes `lambda/predictor.py` every five minutes. It analyzes recent CPU and memory datapoints with a linear trend and can send a Discord pre-alert if a threshold breach appears likely and a webhook is configured. This is a heuristic forecast, not a guarantee of failure prediction.
4. **EC2 lifecycle audit:** EventBridge sends instance state-change events to `lambda/main.py`, which records lifecycle events.
5. **CloudWatch alarms:** Terraform defines alarms for CPU, memory, system status, instance status, and remediation Lambda errors. The alarm named `self-healing-auto-recovery` currently sends an ops SNS notification; it is not configured with the native EC2 recover alarm action. The Health Manager reports EC2 health transitions through its audit log and SNS notifications and does not reboot the instance.

The CPU alarm defaults to 75%. The memory alarm is 60%; the dashboard indicator and predictor now use the same memory threshold.

### Data and storage

- DynamoDB `${project_name}-logs` stores audit events keyed by instance ID and timestamp.
- DynamoDB `${project_name}-state` stores Health Manager state by resource ID.
- DynamoDB `fieldwork-store-commerce` is the planned dedicated Storefront table for products, inventory, orders, and persistent idempotency records. It is not yet owner-created.
- A private, versioned, encrypted S3 audit bucket stores remediation and lifecycle records. Object lifecycle settings expire current records after 90 days and noncurrent versions after 30 days.
- A separate private S3 bucket stages frontend build assets before EC2 syncs them to Nginx.

### Infrastructure and deployment

- `terraform/` contains the infrastructure definitions. The provider defaults to `us-east-1`; variables allow other regions.
- Terraform expects a pre-existing S3 state bucket and DynamoDB lock table configured in `terraform/main.tf`.
- The EC2 instance uses the default VPC, a public IP, an HTTP-only security group, SSM and CloudWatch Agent permissions, and inline user data that installs Nginx and the agent.
- The legacy deploy-frontend.sh script remains paused. CloudFront was created manually and is not yet reconciled with Terraform state/configuration; reconcile before any Terraform apply that could manage CloudFront. AWS changes remain owner-run.
- Batch 3A selects the existing EC2 instance for the first Store API runtime: Node under `systemd`, loopback port 3100, Nginx reverse proxy, Storefront CloudFront path, EC2 instance-role access to DynamoDB, and SSM-based deployment.

## Current limitations and follow-up

- The API has Cognito JWT authorization in Terraform. Maintenance request validation and sanitized error responses are implemented locally; authorization still needs a live AWS check after the project owner applies the Terraform configuration.
- CloudFront provides HTTPS to viewers, but the origin hop is HTTP and the EC2 origin can also be reached directly over HTTP. A custom domain, HTTPS origin, and origin access restriction are not configured.
- The dashboard is one large `App.tsx` component and uses manual polling.
- The health score is calculated by the API. The current React app does not render the returned `health_score` object.
- The predictor runs periodically but its scheduled pre-alert is separate from the CloudWatch alarm remediation path.
- Project documentation and load-test files may contain old target IPs, thresholds, or claims. Confirm against Terraform outputs and deployed AWS state before relying on them.

See IMPLEMENTATION_BATCHES.md for the staged target architecture and owner-run acceptance checks.
