# CloudOps Store

This project combines an operator dashboard for self-healing cloud infrastructure with a customer-facing demo storefront. The redesign uses exactly two separate frontends.

## Current state

- The Fieldwork storefront and CloudOps dashboard are independent Vite apps.
- The storefront is public and still uses a static demo catalog, browser-local cart, and simulated checkout.
- The CloudOps dashboard requires Cognito configuration and sign-in before showing metrics or controls. Its API continues to validate Cognito JWTs.
- The current AWS infrastructure is still the earlier single-EC2 stack. There is no commerce API, RDS database, Redis cache, ALB, or Auto Scaling Group yet.
- AWS resources have not been changed. The legacy single-origin deployment script is paused because it would publish the two apps incorrectly.

## Target architecture

- Storefront static assets: separate private S3 bucket and CloudFront distribution.
- CloudOps static assets: separate private S3 bucket and CloudFront distribution; Cognito sign-in and JWT-protected dashboard APIs.
- Store API: ALB and EC2 Auto Scaling Group.
- Commerce data: RDS for PostgreSQL.
- Catalog cache: private ElastiCache Valkey / Redis-compatible cache, with PostgreSQL as the source of truth.
- Operations: CloudWatch CPU, memory, alarm, ALB, scaling and recovery metrics; existing DynamoDB and S3 audit/state resources remain for CloudOps operations.

The target design and acceptance criteria are documented in docs/IMPLEMENTATION_BATCHES.md. All AWS console changes, Terraform plans/applies, and deployments remain owner-run.

## Start the frontends locally

From the frontend folder, install dependencies with npm ci. Start these in separate terminals:

- npm run dev:storefront — storefront on port 5173
- npm run dev:cloudops — CloudOps on port 5174

Run npm run build and npm run lint to check both frontends. To run the browser smoke checks, start npm run preview:storefront and npm run preview:cloudops in separate terminals, then run npm run test:smoke. On this host the smoke script uses the installed Edge browser when PUPPETEER_EXECUTABLE_PATH is set.

Cognito and API settings belong in the ignored frontend/.env file. If Cognito settings are missing, CloudOps displays a configuration-required page and does not show dashboard data.

## Project layout

- frontend/apps/storefront — public customer storefront
- frontend/apps/cloudops — Cognito-protected operator dashboard
- lambda — CloudOps metrics API, recovery, health management, and predictor
- terraform — current AWS infrastructure definitions and planned migration resources
- load-tests — load test scripts and results
- docs/IMPLEMENTATION_BATCHES.md — ordered batches, checks, and owner-run AWS gates

Do not use the old single-origin deployment instructions until the independent S3 and CloudFront origins are implemented and reviewed. No real payment data should be collected by this demo.
