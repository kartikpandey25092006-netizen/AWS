# AWS Console Work: Owner-Run Batches

This project owner performs every AWS Console change. Finish one batch, send its requested evidence, and wait for AWS Core verification before moving to the next one. Do not share passwords, access keys, session tokens, Cognito tokens, or other secrets in screenshots or chat.

These Console batches prepare and validate the current CloudOps stack. A local Fieldwork Store API contract and DynamoDB persistence adapter exist, but the commerce table and Store API runtime are not deployed. Storefront Cognito, API runtime, and commerce-table configuration are covered by later owner-run batches in `IMPLEMENTATION_BATCHES.md`; there is no payment processor or newsletter backend in scope.

## Batch 0 — Account, Region, and Budget Guardrail

**Goal:** Confirm you are in the intended AWS account and `us-east-1`, and set a spend alert before creating resources.

1. Sign in to the intended AWS account. Check the account ID in the top right account menu; do not paste it into public documentation.
2. Set the Console region selector to **US East (N. Virginia) `us-east-1`**.
3. Open **Billing and Cost Management → Budgets**. Create a monthly cost budget with an amount you are comfortable being notified about. Add email alerts for actual and forecasted spend.
4. Open **Billing and Cost Management → Free Tier** (or the current account's Free Tier/credits page) and review what applies to this account. Do not assume the project is free.

**Return:** Screenshot with account ID obscured, selected region visible, budget status, and confirmation that alerts are configured. AWS Core verifies account/region identity and budget configuration read-only.

## Batch 1 — Terraform State Backend

Terraform's `terraform/main.tf` currently names an existing S3 bucket `self-healing-tfstate-cee9d484` and DynamoDB lock table `self-healing-tfstate-locks`, both in `us-east-1`. First check if they already exist; do not create duplicates.

If missing, create them in the Console:

1. **S3 → Create bucket:** choose the exact configured bucket name and `us-east-1`; keep **Block all public access** on; enable bucket versioning; enable default server-side encryption; do not add a public bucket policy.
2. **DynamoDB → Tables → Create table:** table name `self-healing-tfstate-locks`, partition key `LockID` (String), no sort key, on-demand capacity. Create in `us-east-1`.
3. Confirm the S3 bucket and DynamoDB table are ready. Do not upload or edit a Terraform state object by hand.

**Return:** Bucket name/region/versioning/encryption/public-access screenshot; table name/key/capacity/region screenshot. AWS Core verifies the bucket and table configuration before you run Terraform init.

## Batch 2 — Cognito Operator Sign-In

Terraform creates the User Pool and public SPA app client. The User Pool config allows admin-created users only.

1. In **Amazon Cognito → User pools**, select the `self-healing-user-pool` for the account/region created by Terraform.
2. Create the operator user from **Users → Create user**. Use your own email and a temporary password; do not send the password to me.
3. Complete the initial password change/sign-in in your browser. If the user must be confirmed or have an email verified, do so in the Console using your own account controls.
4. Confirm the app client is a public client with no client secret, uses the authorization code OAuth flow, and has callback/logout entries for the CloudFront URL and `http://localhost:5173/`.

**Return:** Pool ID (not a token), user status, app client ID, and callback/logout URL screenshots with email obscured if preferred. AWS Core verifies pool/client configuration and the user status read-only.

## Batch 3 — SNS Email Subscriptions

1. Open **Amazon SNS → Topics** and select the remediation and operational topics created by Terraform.
2. Confirm the intended email endpoint exists for each topic.
3. Open the two confirmation emails and click **Confirm subscription**. Do not forward these emails.
4. Return to SNS and confirm each subscription status reads **Confirmed**.

**Return:** Topic names and confirmed status. AWS Core verifies the topic subscriptions and status.

## Batch 4 — Runtime Health and API Access

Do this after the infrastructure is deployed by you and the initial Cognito user exists.

1. In **Systems Manager → Fleet Manager / Managed nodes**, check the EC2 instance is online.
2. In **CloudWatch → Alarms**, inspect the alarms and note their state. Verify the memory alarm value against the current Terraform source (60%) and CPU threshold (default 75%).
3. In **API Gateway → APIs**, inspect the HTTP API routes and confirm JWT authorization is attached to `GET /api/status` and `POST /api/maintenance`.
4. In **Cognito → App integration**, compare callback/logout URLs with the current CloudFront URL and local Vite URL.
5. In **CloudWatch → Log groups**, inspect recent API and remediation logs for errors. Do not copy access tokens or PII into screenshots.

**Return:** Instance ID/status, API ID/routes/authorizer status, alarm names/states, and relevant error text with account identifiers redacted. AWS Core cross-checks the EC2, API, Cognito, CloudWatch, and Lambda state read-only.

## Batch 5 — Website Delivery Check

1. Open the CloudFront URL from Terraform output `cloudfront_domain` in a private browser window.
2. Confirm the Fieldwork Store loads and the `/health` endpoint responds.
3. Treat this as a legacy static-delivery check only. The new API-backed catalog, customer order request, and admin pages cannot be verified in AWS until the owner completes the later Storefront Cognito, Store API runtime, and separate-delivery batches. No payment fields should appear.
4. Open the **CloudOps dashboard** link. Confirm Cognito sign-in is required when configured. Confirm an unauthorized API request fails and a valid operator session works.
5. Confirm the deployment uses the CloudFront HTTPS URL. Do not use the EC2 public IP as the public demo URL.

The AWS identity used by `deploy-frontend.sh` also needs permission to create a CloudFront invalidation so new frontend builds are visible without waiting for the default cache lifetime.

**Return:** CloudFront URL, browser results, and any failed request's HTTP status (never include tokens). AWS Core verifies the CloudFront distribution, EC2 origin, API routes, and Cognito settings; browser-only visual checks remain your observation.

## Batch 6 — Origin Security Decision (Before Changing It)

The current design serves viewers through HTTPS, but CloudFront connects to EC2 over HTTP and the EC2 security group permits public HTTP. This is a known limitation.

Before changing security groups or the origin protocol, decide whether the portfolio demo needs a custom domain and whether you can configure origin HTTPS or restrict direct origin access. Do not remove public HTTP ingress until the replacement path is ready, because the current CloudFront origin depends on it.

**Return:** Your chosen approach and a Terraform plan for review. AWS Core checks the resulting security group and CloudFront origin after you make and apply the approved change.

## What to send after each batch

Send the batch number, what you changed, screenshots or non-secret values, and any AWS Console error text. I will verify with AWS Core before giving the next batch. If a required state is missing, I will explain the next Console steps; I will not change it for you.
