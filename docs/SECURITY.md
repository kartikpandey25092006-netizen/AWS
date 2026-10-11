# Security

This document describes the current Terraform and application code, followed by work that remains. A Terraform configuration is not proof that the live AWS resources have the same settings; verify live changes after the project owner applies them.

## Current controls

### Authentication and authorization

- API Gateway has a Cognito JWT authorizer on `GET /api/status` and `POST /api/maintenance`.
- The React app sends the Cognito access token in the `Authorization: Bearer` header.
- The Cognito app client is public and has no client secret. The initial operator user is created administratively.
- Authorization is enforced at API Gateway. The Lambda function should still validate input because clients can send malformed requests even after authentication.

### Cross-origin requests and transport

- API Gateway CORS allows the CloudFront hostname and `http://localhost:5173` for local Vite development. Remove local origins from production configuration when they are no longer needed.
- CloudFront redirects viewer traffic to HTTPS using its default certificate.
- CloudFront connects to the EC2 Nginx origin over HTTP. EC2 also has public HTTP ingress, so users can bypass CloudFront and reach the origin directly. Do not describe the full path as end-to-end HTTPS.

### AWS permissions and storage

- EC2 uses an instance role for SSM, CloudWatch Agent, and read-only access to the frontend assets bucket.
- Separate Lambda roles are defined for remediation, API, Health Manager, and Predictor.
- Audit and state data use DynamoDB. Audit objects are written to an encrypted, versioned S3 bucket with lifecycle expiration.
- Review wildcard resource permissions in the Lambda IAM policies against the exact AWS actions that support resource-level scoping. Keep each function limited to the resources and actions it needs.

## Application safeguards

- `POST /api/maintenance` accepts only a JSON object whose `maintenance` value is a boolean. Invalid JSON or values receive a client error without changing alarms.
- Internal API failures return a generic error to the browser; detailed failures remain in Lambda logs for debugging.
- Keep authentication, input validation, and server-side authorization in place for every route that can expose telemetry or change infrastructure state.
- Do not put payment card data, credentials, tokens, or webhook secrets in source files, frontend bundles, logs, or Terraform outputs.
- The Store newsletter and checkout are demonstration interactions only. The frontend does not save email addresses or orders and does not collect payment details.

## Remaining security work

1. Verify the deployed API returns 401/403 without a valid Cognito token and permits an authorized user.
2. Verify CORS from the deployed CloudFront origin and confirm unapproved origins cannot read responses in a browser.
3. Add role-based authorization before giving admin capabilities (product management, inventory changes, or order access) to a commerce feature.
4. Restrict direct access to the EC2 origin and decide whether to use HTTPS from CloudFront to the origin.
5. Review IAM policy scope and retention periods using the live account's requirements.
6. Add tests for request validation, authorization expectations, and sanitized errors.
