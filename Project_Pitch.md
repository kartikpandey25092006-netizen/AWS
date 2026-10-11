# Self-Healing Cloud Infrastructure on AWS

## Project pitch

### Problem

Small web services can become unavailable because of high resource usage, host health problems, or a failed web process. Manual response takes time and can be hard to demonstrate or audit.

### Objective

Build a portfolio system that monitors a web service, attempts defined recovery actions, records those actions, and gives an operator a dashboard to inspect service health. It demonstrates cloud operations and SRE ideas without claiming that automated recovery guarantees availability.

### How the system works

- CloudWatch monitors CPU, memory, and EC2 health checks.
- CPU and memory alarms publish to SNS, which invokes a Lambda function. The Lambda sends an SSM command to restart Nginx and records the outcome.
- An EventBridge Health Manager runs every minute, checks EC2 status and the service `/health` endpoint, and can attempt a reboot or Nginx restart.
- A separate predictor runs every five minutes, evaluates recent CPU/memory trends, and can send a Discord pre-alert if configured. Its forecast is heuristic.
- EventBridge captures EC2 state changes. DynamoDB stores operational state and audit events; S3 stores audit objects and staged frontend assets.
- Cognito authenticates dashboard users. API Gateway uses a JWT authorizer for its status and maintenance routes.
- React displays the current metrics, recovery state, audit trail, and maintenance control. CloudFront redirects viewer traffic to HTTPS; its current origin connection to EC2 is HTTP.
- The same frontend includes a Fieldwork demo storefront with a static catalog, search, filters, browser-local cart, and simulated checkout. CloudOps remains a separate operator view.

### Portfolio value

The project shows infrastructure as code with Terraform, event-driven automation, operational auditing, and a React experience for both visitors and operators. The storefront is currently a UI demonstration only; a persistent commerce backend is future work. See `docs/PRODUCT_ROADMAP.md`.

### Cost and limits

This is a single-instance demonstration, not a production availability design. Costs depend on account eligibility, region, resource usage, and current AWS pricing. Review a Terraform plan and cost estimate, set a budget alert, and clean up resources after the demo. Do not present the project as guaranteed to fit the Free Tier.

### Demo flow

1. Browse the Fieldwork catalog, filter/search products, add an item to the cart, and place a clearly labeled demo order.
2. Open the CloudOps dashboard and sign in through Cognito.
3. Review CPU, memory, overall health score, and audit panels.
4. In a test environment, trigger a controlled workload and observe alarm evaluation and the recorded recovery attempt.
5. Explain limits: no real payment or persisted order, one EC2 origin, HTTP from CloudFront to origin, and heuristic prediction.
