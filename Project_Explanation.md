# Self-Healing Cloud Infrastructure

## What this project is

This is a portfolio CloudOps system for a small web service running on AWS. It watches the service and its EC2 host, attempts a few automated recovery actions, records the events, and provides an operator dashboard.

## How the parts work together

1. **EC2 and Nginx:** Terraform creates one EC2 web server. Nginx serves the built React frontend, which opens on the Fieldwork demo storefront. SSM lets AWS services send commands to the host without opening SSH access.
2. **CloudWatch and SNS:** CloudWatch collects CPU, memory, and EC2 status metrics. CPU or memory alarms publish to SNS.
3. **Alarm handler:** SNS invokes a Python Lambda for CPU or memory alarms. It records the alert in DynamoDB and S3 and returns an operator-review status; simulated tests do not create real load or trigger recovery commands.
4. **Health Manager:** EventBridge invokes a second Lambda every minute. It checks EC2 health and the Store API health endpoint, tracks retry state in DynamoDB, reports EC2 health changes without rebooting, and can perform the guarded Store API start through the fixed SSM document when recovery is enabled.
5. **Predictor:** A scheduled Lambda analyzes recent CPU and memory trends and can send a Discord warning if configured. This is a trend heuristic, not a guarantee that a failure will be predicted.
6. **API and sign-in:** The React dashboard calls API Gateway. Cognito provides sign-in, and API Gateway requires a valid JWT on both dashboard routes. The API reads metrics and audit/state data and computes a custom health score.
7. **Frontend delivery:** The deployment script uploads the Vite build to S3, asks EC2 through SSM to sync it into Nginx, and CloudFront serves the site over HTTPS to viewers. The CloudFront-to-EC2 origin hop is currently HTTP, and the EC2 origin is directly reachable over HTTP.

## What the dashboard shows

The React frontend opens on a Fieldwork storefront with a static demo catalog, category filters, search, cart, and simulated checkout. The product catalog and cart are browser-only; the app does not create saved orders, inventory, or payments. The CloudOps dashboard remains available from Store navigation. It polls every 10 seconds and displays uptime, CPU/memory graphs, recovery state, health score, audit events, and a maintenance toggle.

## Important limits

- Recovery is attempted, not guaranteed. A single EC2 instance is not a high-availability architecture.
- The `self-healing-auto-recovery` alarm name is retained for compatibility, but its configured action is an ops notification only. EC2 health checks are alert-only; guarded Store API start is the only recovery action in the Health Manager.
- The memory alarm, dashboard indicator, and predictor use a 60% threshold. Confirm it against Terraform before changing or testing the deployed stack.
- AWS costs depend on the account, region, and current usage. Do not assume deployment is free.
- The storefront is only a portfolio UI. Its product model, persistence, inventory/fulfillment, and customer/admin authorization need decisions before adding backend commerce behavior. See `docs/PRODUCT_ROADMAP.md`.
