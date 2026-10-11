# Test Plan

## Local backend unit tests

The repository uses Python's standard-library `unittest` for the first API and health-score tests. The API test module stubs boto3 clients so these tests do not contact AWS.

From the project root:

```bash
python -m unittest discover -s lambda/tests -v
```

Current coverage includes:

- Invalid JSON and invalid `maintenance` values.
- Correct response for a valid maintenance request.
- Unknown routes and unsupported methods.
- Sanitized internal-error responses.
- Healthy and degraded health-score inputs.

## Frontend checks

Install dependencies from the `frontend` folder with `npm ci`, then run:

```bash
cd frontend
npm run build
npm run lint
```

Add Vitest and React Testing Library in a separate task. Suggested component tests:

- Render metrics and graphs from mock API data.
- Render loading, failed-request, and empty-audit states.
- Maintenance toggle sends the expected request and rolls back on failure.
- Cognito-protected views show sign-in when the session is missing.
- Store category/search, quick add, quantity updates, empty cart, and simulated order confirmation.

For a browser smoke check, start `npm run preview` after the build and run `node check-local.cjs` from `frontend`. To check a deployed site, set `TARGET_URL` to the CloudFront HTTPS output before running `node check-live.cjs`.

## AWS integration checks (owner-run)

These checks require a deployed test environment and the project owner's AWS account. Review a Terraform plan first. Run recovery tests only when the owner is ready for the instance workload and possible charges.

- Verify no-token API requests are rejected and valid Cognito tokens work.
- Verify CORS from the CloudFront origin.
- Confirm Nginx, SSM registration, and the configured CloudWatch alarms.
- Validate CPU alarm → SNS → remediation Lambda → SSM in a staging/demo deployment.
- Validate Health Manager EC2 status and application `/health` recovery separately.
- Verify audit records in DynamoDB and S3, scheduled predictor behavior, and notifications.
- Stop the test load and confirm the instance and alarms return to a healthy state.

## Future commerce tests

- Product visibility and catalog filtering.
- Server-side price calculation and cart quantity validation.
- Retry-safe demo order creation.
- Customer order ownership and administrator role checks.
- Product/inventory/order updates and audit events.
- Storefront and simulated checkout flow from browser to API.
