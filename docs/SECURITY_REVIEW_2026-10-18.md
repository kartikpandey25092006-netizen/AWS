# Security review — 2026-10-18

Scope: static source/configuration review plus owner-supplied evidence from this conversation. No exploitation, dependency audit, automated tests, live AWS inventory, or AWS changes. The connector previously failed; Terraform is desired configuration, not proof of live settings. No secret values were read.

## Findings and order of work

1. **Protect authenticated API transport before public use.** `terraform/ec2.tf:16` permits public port 80; `terraform/cloudfront.tf:17` uses an HTTP origin. The owner previously demonstrated the live Nginx HTTP proxy. Sending bearer tokens or customer addresses directly over HTTP exposes them on that network path. CloudFront viewer HTTPS alone would not encrypt its HTTP origin hop. HTTPS origin design and direct-origin restrictions need preparation and owner deployment; do not close port 80 blindly because current public health checks use it.
2. **Remove the residual command fallback.** `lambda/main.py:88` routes recognized CPU/memory alerts to attention-only reporting, but an unrecognized ALARM with an InstanceId still reaches SSM Nginx restart at line 121. It does not validate an allowed topic, alarm ARN, namespace/metric combination or target against a configured allowlist. Invocation requires AWS permissions; this is not evidence of an anonymous exploit. Fail closed for unrecognized alarms, preserve lifecycle logging, and review live invoke permissions.
3. **Reduce write/command permission scope.** `terraform/iam.tf:137` allows remediation SSM commands on wildcard resources; Health Manager combines describes, reboot and SSM operations at line 285. API alarm toggles also use wildcard scope. Review supported action/resource combinations, separate read permissions from mutating operations, and restrict command documents, instance targets and alarm actions where supported. The owner pasted the live Health Manager wildcard policy; other roles are source evidence only.
4. **Restrict SNS service publishing context.** `terraform/monitoring.tf` grants CloudWatch Publish without source-project/source-alarm conditions. Review the live topic policy and prepare conditions for the intended alarm ARNs and project. Lambda SNS invoke permission is scoped to the topic in Terraform; verify live configuration separately.
5. **Correct admin PATCH authentication error handling.** `services/store-api/src/app.mjs:306` omits logger when calling requirePrincipal, whose rejection paths call logger.warn. A missing/invalid token can therefore produce generic 500 instead of expected 401. Authorization still fails closed: no evidence this bypasses access checks. Pass the logger consistently or default it in the helper.
6. **Verify host protections and production edge controls.** Terraform does not explicitly require IMDSv2 or explicitly encrypt the root volume. Effective live metadata options and project EBS defaults are unknown. Reviewed Nginx snippet has no request-rate limits and no explicit body limit; wider Nginx settings remain unknown. Production response headers/CSP were not verified. Browser tokens are in sessionStorage, which remains accessible to same-origin scripts. Inspect dependencies and deployed headers before claiming production readiness.

## Controls observed in code

- Store API verifies Cognito access-token signatures through aws-jwt-verify with configured pool, client and token use; missing auth configuration blocks protected routes.
- Store admin routes check exact store-admin group membership on each request. CloudOps checks Gateway-provided JWT claims server-side; secure deployment still depends on the Gateway authorizer/integration and no public direct Lambda invocation path.
- Customer order queries use the authenticated subject; cancellation checks ownership and includes the owner in the conditional update.
- Order values are derived from repository catalog data; request fields, quantities and 32 KiB JSON bodies are validated.
- Store API binds to loopback by default; systemd uses a dedicated service identity and hardening settings.
- Terraform specifies public-access blocks and SSE-S3 for audit/frontend buckets. Live settings were not reverified.
- CPU and memory simulated handlers were owner-tested as attention-only; actual Store API stop/recovery was separately owner-verified.

## Recommended first implementation

Remove the unrecognized-alarm SSM fallback, then correct the PATCH logger bug. Both can be prepared locally without changing live infrastructure. HTTPS and role/topic changes require a concrete deployment plan and owner application. Do not broaden the EC2 role simply to enable an alarm-delivery test.

## Owner evidence and follow-up — 2026-10-18

- The owner confirmed the remediation role policy no longer contains the SSM command permission; a CPU simulation still wrote its audit records.
- The owner saved CloudWatch SNS topic conditions for the project account and the exact CPU/memory alarm ARNs. Actual alarm-to-SNS delivery remains unverified.
- The owner replaced the Health Manager's broad EC2/SSM statement with instance-scoped reboot and command permissions. A controlled Store API recovery was recorded as `Guarded Store API start requested` followed by `Start Store API verified` / `RECOVERED`.
- Additional least-privilege hardening is prepared locally: replace general-purpose `AWS-RunShellScript` with a parameter-free custom SSM document. The document, Lambda package, and Terraform changes still require owner review/deployment; no AWS resources were changed by the assistant.
