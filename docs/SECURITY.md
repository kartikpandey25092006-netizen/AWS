# Security

This document describes the current Terraform and application code, followed by work that remains. A Terraform configuration is not proof that the live AWS resources have the same settings; verify live changes after the project owner applies them.

## Current controls

### Authentication and authorization

- API Gateway has a Cognito JWT authorizer on `GET /api/status` and `POST /api/maintenance`.
- The updated CloudOps Lambda also requires exact `store-admin` membership in Gateway-verified JWT claims for those routes and the new `GET /api/session`. The app waits for server approval before showing metrics or enabling controls, and Storefront links are hidden from customers. The requested shared administrator SSO uses the Storefront Cognito identity and `prompt=none` with authorization code + PKCE, keeping tokens out of navigation URLs. Deploy the group checks before trusting the shared customer/admin pool; see `CLOUDOPS_SSO_SETUP.md` for the ordered owner migration.
- The React app sends the Cognito access token in the `Authorization: Bearer` header.
- The Cognito app client is public and has no client secret. The initial operator user is created administratively.
- Authorization is enforced at API Gateway. The Lambda function should still validate input because clients can send malformed requests even after authentication.
- Storefront admin login completes only after `GET /api/admin/session` verifies the Cognito access token and its exact `store-admin` group claim in the Store API. Failed or unavailable verification blocks the UI and removes the attempted browser session. Administrator order endpoints independently repeat the same server-side check on every request.
- Customer and admin entry points share the existing Cognito app client. Cognito can authenticate a customer's credentials on the shared hosted page, but the application rejects that user from the admin sign-in flow. Only the project owner manages administrator group membership in AWS. Group changes affect newly issued tokens; an existing valid token retains its claims until expiration.

### Cross-origin requests and transport

- API Gateway CORS allows the CloudFront hostname and `http://localhost:5173` for local Vite development. Remove local origins from production configuration when they are no longer needed.
- CloudFront redirects viewer traffic to HTTPS using its default certificate.
- CloudFront connects to the EC2 Nginx origin over HTTP. EC2 also has public HTTP ingress, so users can bypass CloudFront and reach the origin directly. Do not describe the full path as end-to-end HTTPS.

### AWS permissions and storage

- EC2 uses an instance role for SSM, CloudWatch Agent, and read-only access to the frontend assets bucket.
- Separate Lambda roles are defined for remediation, API, Health Manager, and Predictor.
- The Health Manager's Store API recovery uses a parameter-free project SSM Command document with a fixed start-and-verify script. Its `ssm:SendCommand` permission is scoped to that document and the selected EC2 instance; the function role cannot update the document. EC2 status checks are alert-only; the Health Manager role does not need `ec2:RebootInstances`.
- Audit and state data use DynamoDB. Audit objects are written to an encrypted, versioned S3 bucket with lifecycle expiration.
- Review wildcard resource permissions in the Lambda IAM policies against the exact AWS actions that support resource-level scoping. Keep each function limited to the resources and actions it needs.

## Application safeguards

- `POST /api/maintenance` accepts only a JSON object whose `maintenance` value is a boolean. Invalid JSON or values receive a client error without changing alarms.
- Internal API failures return a generic error to the browser; detailed failures remain in Lambda logs for debugging.
- Keep authentication, input validation, and server-side authorization in place for every route that can expose telemetry or change infrastructure state.
- Do not put payment card data, credentials, tokens, or webhook secrets in source files, frontend bundles, logs, or Terraform outputs.
- Storefront order requests contain no payment details. The API stores order ownership, item snapshots, shipping addresses, and status history in the dedicated DynamoDB commerce table using the runtime's AWS role. Do not log shipping addresses or Cognito access tokens.

## Remaining security work

1. Verify the deployed API returns 401/403 without a valid Cognito token and permits an authorized user.
2. Verify CORS from the deployed CloudFront origin and confirm unapproved origins cannot read responses in a browser.
3. Grant the selected EC2 runtime role only the required actions on the commerce table and its indexes; never grant browser clients direct DynamoDB access.
4. Restrict direct access to the EC2 origin and decide whether to use HTTPS from CloudFront to the origin.
5. Review remaining IAM policy scope and retention periods using the live project's requirements. The Health Manager still needs wildcard resources for APIs that do not support resource-level scoping, including `ec2:DescribeInstances`, `ec2:DescribeInstanceStatus`, and `ssm:GetCommandInvocation`.
6. Add tests for request validation, authorization expectations, and sanitized errors.
