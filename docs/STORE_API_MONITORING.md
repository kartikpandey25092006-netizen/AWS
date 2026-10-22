# Store API monitoring — prepared 2026-10-17

## Local implementation

The API records completed `/api` responses, excluding health probes, OPTIONS, static files, and aborted responses. These are request counts, not unique visitors. Only status and elapsed time reach the observer; no tokens, customer IDs, URLs, query strings, or order IDs are metric labels.

The SDK publisher sends at minute boundaries to namespace `Fieldwork/StoreApi`, dimensions `Service=store-api` and `InstanceId=<monitored EC2 instance>`. Its five metric names are `RequestCount`, `ClientErrorCount` (4xx), `ServerErrorCount` (5xx), `CollectionSeconds`, and `ResponseDuration` (milliseconds). Duration is a statistic set of sample count, sum, minimum, maximum. The dashboard reports a weighted average, not p95 or end-user page-load time.

Publishing is asynchronous, outside the HTTP response path, with bounded SDK retries and a four-second deadline. Failed batches generate a sanitized warning and remain gaps rather than false zeroes. Later traffic remains in the next batch. These are operational metrics, not exactly-once billing/accounting. Shutdown flushing is best effort. The existing CloudWatch Agent CPU/memory configuration is preserved.

The protected CloudOps `/api/status` reader uses its existing `cloudwatch:GetMetricStatistics` permission and queries five completed minutes, cached for one minute per warm Lambda. It joins periods with collection evidence and all counters, uses observed seconds for request rate, and calculates weighted latency only when duration sample count matches request count. Missing latency stays unavailable. Partial windows are labelled. Samples older than three completed minutes are stale. The cards do not follow the CPU chart's selected time range or change existing health scoring or remediation.

The dashboard shows requests, requests/minute, average response time, server errors plus error rate, and client errors. Freshly observed idle traffic is zero; idle latency/error percentage remain unavailable. Missing/stale data, read errors, or failed dashboard refreshes show unavailable values.

## Native Lambda Web endpoint metrics

CloudOps also reads AWS-managed metrics for the Lambda Web endpoint `storefront` on function `fieldwork-store-api-web`. These appear in a separate **Lambda API activity** section so their counts are not mixed with the EC2 Store API telemetry above. The reader uses one-minute points from the last five completed minutes and caches for one minute. It reads endpoint request/error metrics and execution-environment resource metrics in `AWS/Lambda/Web`, plus active-environment and throttle metrics from `AWS/Lambda/Web/Usage`. It reports request count/rate, 4xx/5xx responses, CPU time, peak memory, concurrent requests per environment, active environments, and endpoint/environment throttles. With no data points, counts display as zero and capacity measurements remain unavailable. Lambda Web metrics count requests reaching this endpoint's execution environments; they do not count requests routed directly to the EC2 origin.

AWS publishes request metrics only when they have values; use `Sum` for counts. The 4xx metric includes Lambda throttling responses. Execution-environment CPU/memory metrics have only a `FunctionName` dimension and therefore can aggregate all endpoints on the function. AWS does not publish request latency as a native Lambda Web metric; deriving it requires request-complete system logs or application instrumentation. See [AWS Lambda Web metrics](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-monitoring-metrics.html) and [Lambda Web logs](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html).

The CloudOps API already has `cloudwatch:GetMetricStatistics` permission. The Lambda Web endpoint and function names can be overridden with `LAMBDA_WEB_ENDPOINT_NAME` and `LAMBDA_WEB_FUNCTION_NAME` on the CloudOps API Lambda; the current defaults match the deployed resources.

Prepared deployment artifacts for the native Lambda Web metric display:

- `lambda/cloudops-lambda-web-metrics-2026-10-22.zip`: updated `api.py` only, for the existing `self-healing-api` Lambda. Keep its current handler, role, environment, and API Gateway JWT authorization.
- `frontend/dist/cloudops/`: built CloudOps frontend. Deploy its contents to the existing CloudOps frontend origin and invalidate that origin's CloudFront cache as usual; do not upload it to the Storefront bucket.

No AWS resources are changed by preparing these artifacts. Verify the deployed CloudOps API response includes `lambda_web_metrics` and that the Lambda API activity section matches CloudWatch in the selected `us-east-1` Region.

## Release files and defaults

- `services/store-api/deploy/fieldwork-store-api-release-v3.zip`: eight current files, including metrics source, package manifest and lockfile with the pinned CloudWatch SDK.
- `lambda/cloudops-application-metrics-api-2026-10-17.zip`: only `api.py`, retaining admin checks and CPU/memory fixes.
- Each archive has a sibling `.manifest.json` with verified SHA-256 hashes. Neither contains environment files or installed dependencies.
- CloudOps frontend source/build include the monitoring cards. Live frontend delivery remains separate from the Storefront upload.
- Publishing is OFF by default. The owner must set `STORE_METRICS_ENABLED=true` and `STORE_METRICS_INSTANCE_ID=i-05873747f092327bf` in the EC2 service environment.

Custom metrics and reads can incur CloudWatch charges. Fixed labels limit this rollout to five series for one instance; no per-user or per-route series are created. Disabling publishing stops new samples, but stored metrics follow CloudWatch retention.

## Owner deployment order

1. Upload v3 to `s3://self-healing-frontend-cee9d484/batch3a/fieldwork-store-api-release-v3.zip`.
2. In SSM, download to `/tmp/fieldwork-store-api-release-v3.zip`. Check its SHA-256 against the release manifest. Inspect `readlink -f /opt/fieldwork/store-api/current` before changing it.
3. Create a fresh `/opt/fieldwork/store-api/releases/2026-10-17-v3`, unpack the ZIP, assign the existing service user ownership, and install locked dependencies with the same `npm-22 ci --omit=dev --ignore-scripts --no-audit --no-fund` procedure used for v2. Keep v2 for rollback.
4. Confirm the instance role can publish with `cloudwatch:PutMetricData`. Earlier inspection found `CloudWatchAgentServerPolicy` attached; its documented policy includes that action. If permissions changed, use a namespace-scoped grant, not administrative access. The Lambda reader uses its existing `GetMetricStatistics` permission.
5. Back up `/etc/fieldwork/store-api.env`, then set the two metrics options exactly once, retaining existing Region/database/Cognito/CORS settings. Keep the loopback listener and `AWS_REGION=us-east-1`.
6. Switch the `current` symlink to v3 and restart only `fieldwork-store-api`. Verify systemd status, health, Nginx catalog, and journal warnings. This telemetry update requires no Nginx/systemd-unit changes.
7. Make a bounded number of read-only catalog requests and one `/store-api/api/missing` request (expected 404). Wait through a minute boundary and CloudWatch ingestion, then check the namespace and exact instance dimensions. Idle intervals should also publish zero counters and positive collection time. Do not induce a production 500 or CPU spike for this check.
8. Upload the new Lambda ZIP to `self-healing-api`, retaining handler `api.handler`, role, environment and API Gateway JWT authorization. Confirm deployed code identity and anonymous session denial.
9. Refresh the admin CloudOps development dashboard and compare its cards to CloudWatch. Partial initial windows and unavailable idle latency are expected. Live CloudOps HTTPS deployment remains pending independently.

Rollback: restore the v2 release symlink and backed-up environment, then restart only the API. Alternatively disable the v3 publishing flag. Application cards should become stale/no-data, not claim health. This change does not enable application alarms or automatic restarts for 5xx errors.

## Verification

All 15 Store API tests and 28 Lambda tests passed, including failed publishing, concurrency, observation isolation, 404/500 capture, exact dimensions, caching, idle/missing/stale data and authorization. CloudOps TypeScript/build passed. Lint has four existing component-export warnings. The isolated CloudOps browser suite passed including six new metric states and existing admin/customer/SSO/sign-out/revocation checks. Identity/API traffic was mocked. Both ZIPs match source bytes.

No AWS changes or actual metric publication were performed during preparation. Live delivery, deployed code, and real Storefront traffic must be verified after owner activation.

## AWS references

- [PutMetricData and statistic sets](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricData.html)
- [CloudWatchAgentServerPolicy permissions](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/CloudWatchAgentServerPolicy.html)
