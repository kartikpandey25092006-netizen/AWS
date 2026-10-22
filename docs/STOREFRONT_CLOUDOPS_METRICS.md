# Storefront traffic in CloudOps

## Intended path

Storefront browser -> uncached `/store-api/*` path -> Nginx on `self-healing-web-server` -> Store API on `127.0.0.1:3100`. The admin-only CloudOps API reads CPU and memory metrics for that same EC2 instance from CloudWatch.

Static Storefront assets may be served by S3 and CloudFront. Requests served entirely from the CDN do not use EC2 CPU or memory. The Storefront calls `/api/products` on page load; once its Store API URL points through the uncached path, each catalog request reaches the monitored server.

## Current verified state (2026-10-17)

- The monitored EC2 instance is `i-05873747f092327bf` in the selected Region `us-east-1`. The CloudOps Lambda `INSTANCE_ID` points to it.
- The local Storefront uses `VITE_STOREFRONT_API_URL=http://127.0.0.1:3100`; this is a Store API on the developer's computer, so local visits cannot increase EC2 load.
- No CloudFront distributions exist yet in this project. The Store API EC2 deployment and HTTPS `/store-api/*` route remain owner-run work described in `STORE_API_RUNTIME.md`.
- EC2 CPU samples are present. CloudWatch Agent publishes `mem_used_percent` with the instance's private DNS name in the `host` dimension; it does not currently publish an `InstanceId` memory series. The live API and high-memory alarm currently request `InstanceId`, so they cannot read that memory series.
- The local CloudOps API now requests the verified `host` series. The dashboard shows unavailable memory as `NO DATA` instead of `0%`. The prepared owner-upload package is `lambda/cloudops-metrics-api-2026-10-17.zip`, containing only `api.py`.
- The high-memory alarm remains configured with `InstanceId` and has no matching series. Do not change only its dimension to `host`: the remediation Lambda requires an `InstanceId` in alarm events. Reconcile CloudWatch Agent publishing and remediation event parsing together before enabling memory alarms as a protection claim.

## Owner-run activation order

1. Upload the prepared CloudOps Lambda package to `self-healing-api` through the AWS Console. Confirm its code update succeeds, then sign in as an admin and check the Memory tab. It should show the actual CloudWatch Agent value, not zero.
2. Complete the Store API deployment gate in `STORE_API_RUNTIME.md`: verify commerce data, upload `services/store-api/deploy/fieldwork-store-api-release-v2.zip`, inspect active Nginx configuration, then install the Store API service on this same EC2 instance. Confirm `curl http://127.0.0.1:3100/health` from an SSM terminal session on the EC2 instance.
3. Create the separate HTTPS Storefront distribution with a `/store-api/*` behavior that forwards to this EC2/Nginx origin without caching. Confirm `/store-api/health` and `/store-api/api/products` return successful responses through that distribution. Keep the Store API's direct port 3100 private.
4. Build and deploy Storefront with `VITE_STOREFRONT_API_URL=https://<storefront-domain>/store-api`. Confirm the browser's catalog request reaches that URL. Keep the CloudOps API's `INSTANCE_ID` pointing to the same EC2 instance.
5. Run the bounded `load-tests/phase1-baseline.js` pilot against the Storefront HTTPS URL. It requests both the page and the uncached Store API catalog. Compare baseline and load intervals in CloudOps and CloudWatch. Stop if latency, errors, or EC2 health degrade.

CloudOps polls every 10 seconds, but polling does not make AWS metrics instantaneous. This instance uses basic EC2 monitoring, so CPU can lag by about five minutes; CloudWatch Agent memory samples are collected every minute. A small number of visitors may produce little visible CPU or memory change.

No AWS resources were changed while preparing this work.
