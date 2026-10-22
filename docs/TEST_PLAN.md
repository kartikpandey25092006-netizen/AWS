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

## CloudOps administrator access

- Run `npm run test:cloudops-access` from `frontend` for isolated browser checks of desktop/mobile link visibility, direct URL access, token role claims, server approval, API failures, later permission denial, and sign-out/polling cleanup. Every external request is intercepted; no AWS actions occur.
- The CloudOps Python tests cover trusted Gateway claims, exact administrator groups, session verification, rejection of forged identities, and zero AWS service calls on denial.
- Both apps now have the shared Storefront identity in the local environment. Owner callback registration and CloudOps JWT trust migration are still required before a real integration check; see `CLOUDOPS_SSO_SETUP.md`.
- The browser suite also covers no-prompt shared-admin SSO, PKCE code exchange, replacing an older dashboard session, rejecting customers who forge the navigation marker, expired-session recovery without a loop/second credential form, and server denial after successful SSO. Header/footer/order links must contain only navigation intent, never credentials.

## Commerce tests

- Product visibility and catalog filtering.
- Server-side price calculation, cart quantity validation, retry-safe order creation, customer order ownership, administrator role checks, cancellation, acceptance, and stock behavior are covered by the local Store API test suite.
- Browser smoke tests cover the API-backed catalog, unconfigured sign-in checkout gate, customer/admin route gates, and unauthenticated CloudOps lock. Add authenticated checkout, cancellation, and admin-authorization tests after test Cognito users are available.
- Run the owner-operated DynamoDB persistence command, then create an authenticated order, restart the Store API, and confirm the same customer can still retrieve it.
- Add repository concurrency tests for acceptance conflict/retry behavior and no oversell outcome.
- Test the Storefront request flow against the API with no payment fields or payment data.

### Admin sign-in regression checks

- Run `npm test` from `services/store-api` to verify the admin-session approval route rejects missing/invalid tokens, customers, lookalike groups, and role/email fields without the actual `store-admin` group. It also fails closed if Cognito verification is not configured.
- With the configured local storefront running, execute `npm run test:admin-signin` from `frontend`. The browser suite intercepts all OAuth and API traffic, uses synthetic fixtures, and makes no real AWS requests. Set `PUPPETEER_EXECUTABLE_PATH` to an installed Chromium browser if Puppeteer's bundled browser is unavailable.
- Browser cases cover customer rejection and session cleanup, lookalike group rejection, server rejection despite a browser-side admin claim, unavailable verification, approved admin entry after verification, and the unchanged customer login. Reloading after a rejected admin login must remain signed out.
- Real Cognito login and any deployment/configuration changes remain owner-run. Sign out and sign in again after changing group membership to obtain updated token claims.
