# Store API health monitoring — prepared 2026-10-17

The existing Health Manager checked the static Nginx `/health` page and selected a Nginx restart on failure. That cannot establish Store API liveness. Owner terminal output confirms `/store-api/health` currently returns HTTP 200 with `{"status":"ok"}`.

The prepared update checks the same instance's `/store-api/health` over the existing HTTP path, with a five-second timeout and a 4096-byte body limit. It requires HTTP 200 and a JSON object with `status=ok`; HTML, wrong JSON, oversized bodies, non-200 responses, missing IP and network errors are unhealthy. No bearer token or other credential is sent. The existing public HTTP origin hop remains a documented demo limitation.

Application monitoring records HEALTHY/UNHEALTHY, `checked_at`, and `health_path` in the existing `app-health` state record. Status transitions generate `health` audit events and SNS notifications, without claiming an automated remediation. Repeated unchanged states do not repeat alerts. App failures do not send SSM commands or restart Nginx/Node. Existing EC2 recovery selection is preserved. Store API systemd Restart=on-failure remains a separate mechanism.

This is liveness through Nginx, not a runtime DynamoDB readiness test. A failed proxy check alone does not identify whether Node, Nginx or network connectivity caused the failure. Targeted Store API recovery should be introduced only with that diagnostic distinction and bounded retries. Existing state write/read failure handling and dashboard health freshness are separate follow-up work; no new freshness guarantee is claimed here.

## Owner deployment

1. In Lambda `self-healing-health-manager`, save a backup of the current deployment package using Download.
2. Under Code source, use Update / upload ZIP and select `lambda/store-api-health-monitor-2026-10-17.zip`.
3. Keep handler `health_manager.handler`, existing four environment variables, execution role, timeout, and schedule. The ZIP contains only the current `health_manager.py`, verified byte for byte; its sibling manifest contains the ZIP SHA-256.
4. After successful update, allow the scheduled invocation to run and inspect its CloudWatch log for errors. Do not manually stop the service for an outage test during this deployment.
5. Inspect the `app-health` item in `self-healing-state`: confirm `health_path=/store-api/health`, a recent `checked_at`, and HEALTHY. Confirm CloudOps still reads that state. This distinguishes the new monitor from an unchanged legacy static-page result.

All 34 Lambda tests passed using mocked AWS/network clients, including six new health-monitor tests. No live AWS changes, SNS messages or recovery actions were executed by the assistant. The owner performs deployment and live verification.
