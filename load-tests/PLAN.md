# CloudOps Load Testing Plan

## Overview

A staged portfolio load-test plan for a user-owned AWS demo deployment. It uses the current Terraform outputs and should only run against an environment you control after checking the estimated load and cost.

---

## Environment

| Parameter | Value |
|---|---|
| **Target** | Set `TARGET_URL` to the current CloudFront URL from Terraform output `cloudfront_domain` |
| **Application** | Storefront static frontend plus the uncached Store API on the monitored EC2 instance |
| **Self-Healing Trigger** | CloudWatch alarm at CPU > 75% for 5 min |
| **Recovery Action** | Lambda → SSM → `systemctl restart nginx` |
| **Monitoring** | CloudWatch metrics + React CloudOps Dashboard |
| **Load Generator** | A local machine with k6 and AWS CLI configured |

---

## Tools Used

| Tool | Why |
|---|---|
| **k6** (Grafana) | Modern, scriptable, low-overhead. Outputs percentile latencies natively. Single binary, no JVM. |
| **stress-ng** (on-server) | Direct CPU/memory pressure — bypasses network efficiency of Nginx for static files. |
| **Custom Bash scripts** | Quick validation and smoke tests. |
| **CloudWatch CLI** | Real-time alarm state monitoring from terminal. |

---

## Metrics We Measure

| Metric | Source | Why |
|---|---|---|
| **Response latency** (p50, p95, p99) | k6 | Detect degradation under load |
| **Error rate** (% of non-2xx) | k6 | Detect when Nginx starts dropping |
| **Requests/sec throughput** | k6 | Baseline capacity |
| **CPU Utilization** | CloudWatch | Verify alarm threshold crossing |
| **Memory Utilization** | CloudWatch Agent `mem_used_percent` | Track memory on the same EC2 instance |
| **Alarm State transitions** | CloudWatch API | Confirm self-healing triggers |
| **Lambda invocations** | CloudWatch Logs | Confirm remediation fires |
| **Recovery time** | Audit logs (DynamoDB/S3) | Measure MTTR |

---

## Three-Phase Plan

### Phase 1: Pilot Test (Baseline)
**Goal**: Establish normal performance baseline.
- 10 virtual users, 2 minutes
- Each iteration requests the Storefront page and `/store-api/api/products` on the monitored EC2; the `/store-api/*` CloudFront behavior must have caching disabled. A test of only the static page would measure CloudFront/S3, not EC2 load.
- Measure baseline latency and throughput
- Confirm instance stays healthy

### Phase 2: Scaling Test (Ramp)
**Goal**: Observe modest, controlled load against the demo endpoint.
- Default ramp is capped at 25 virtual users; configure `MAX_VUS` from 5 to 100 only after reviewing the impact.
- Stop the run if latency, errors, or account cost rises unexpectedly.
- Monitor CloudWatch alarm state

### Phase 3: Stress Test (Self-Healing Validation)
**Goal**: Trigger the CPU alarm and observe the configured recovery path.
- Use the script's bounded `stress-ng` run on the test instance.
- This phase does not generate simultaneous HTTP traffic.
- Verify: Alarm fires → Lambda triggers → Nginx restarts → Health recovers
- Measure total recovery time (MTTR)

---

## Constraints & Safety

> [!WARNING]
> - Load may affect performance, consume burst capacity, trigger recovery, and incur charges. Pricing and eligibility depend on the account, region, date, and usage. Do not assume tests are free.
> - **Do NOT run `while true; do curl & done`** — this forks thousands of processes on YOUR Mac and can freeze it.
> - Phase 3 is capped at 600 seconds and attempts to stop `stress-ng` when the script exits.
> - Keep AWS credentials in your configured AWS profile; never put credentials in test scripts.

## Running a phase

From the repository root in a Bash-compatible terminal, set the AWS profile and region you intend to use, then set the deployed CloudFront URL:

```bash
export AWS_PROFILE=codex-kartik
export AWS_REGION=us-east-1
export TARGET_URL="$(terraform -chdir=terraform output -raw cloudfront_domain)"
```

Run Phase 1 first:

```bash
k6 run -e TARGET_URL="$TARGET_URL" load-tests/phase1-baseline.js
```

Only after reviewing Phase 1 results, run the conservative ramp:

```bash
k6 run -e TARGET_URL="$TARGET_URL" -e MAX_VUS=25 load-tests/phase2-ramp.js
```

Run Phase 3 only when you are prepared for a CPU alarm and recovery action:

```bash
bash load-tests/phase3-stress.sh --cpu-load 95 --duration 360
```

The scripts use AWS CLI credentials for AWS operations. Review the current Terraform outputs and account before running them; do not use the old instance identifiers or IP addresses from previous reports.

---

## Deliverables

1. ✅ `load-tests/phase1-baseline.js` — k6 pilot test script
2. ✅ `load-tests/phase2-ramp.js` — k6 scaling test script  
3. ✅ `load-tests/phase3-stress.sh` — Full self-healing stress test
4. ✅ `load-tests/monitor.sh` — Real-time terminal monitoring dashboard
5. ✅ `load-tests/report.sh` — Post-test report generator
