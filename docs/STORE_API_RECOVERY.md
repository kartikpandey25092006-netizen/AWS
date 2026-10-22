# Targeted Store API recovery — prepared 2026-10-17

## Scope and defaults

The owner verified the live monitoring update in DynamoDB: `app-health` has `status=HEALTHY`, `health_path=/store-api/health`, and checked_at `2026-10-17T07:36:44.196981+00:00`. Owner systemd output shows the API active/running with `Restart=on-failure` and `NRestarts=0`.

The next package, `lambda/store-api-targeted-recovery-2026-10-17.zip`, adds opt-in process recovery to the existing Health Manager. It contains only `health_manager.py`; handler remains `health_manager.handler`. Its sibling manifest includes verified source/archive SHA-256 hashes. It is not deployed by the assistant. Missing `APP_RECOVERY_ENABLED` or any value other than exact `true` leaves new command dispatch disabled.

Systemd already handles process crashes. This layer handles a stopped/failed process left behind after a failing Store API proxy health check. It is not dependency repair, a hung-process restarter, or Nginx/network remediation. EC2 status monitoring is alert-only; it does not reboot the instance.

## Recovery behavior

1. Check the actual `/store-api/health` JSON response and consistently read `app-health` from DynamoDB. If state cannot be read or conditionally written, do not dispatch recovery.
2. If an earlier command is pending, inspect that exact command ID on a later scheduled invocation. SSM results are eventually consistent; absence or uncertainty never authorizes a replacement command.
3. Healthy service checks do not send new commands. Unhealthy checks require the enable flag, confirmed EC2 health, no pending/uncertain command, fewer than three recovery command attempts in the unhealthy episode, and a 120-second cooldown after the last attempt.
4. Reserve the action with a version-conditional DynamoDB write and persist a requested audit event before dispatch. Concurrent invocations cannot reserve the same version. A failure to write the audit also prevents dispatch.
5. The fixed script is held in the parameter-free `self-healing-start-store-api` SSM Command document (`lambda/store_api_recovery_document.json`). The document obtains a host lock and checks that `fieldwork-store-api` exists and is enabled. Active, transitioning, locked, or disabled services are skipped. For inactive/failed state only, it uses an idempotent `systemctl start`; if systemd recovered concurrently, start does not interrupt the active process. Failed-state start limits are reset only in that branch. It does not stop/restart an active API, Nginx, or the EC2 instance. The Health Manager passes no command parameters and IAM allows only this document on the selected instance.
6. The script requires active service state and valid direct loopback health JSON after start. Its start timeout is 12 seconds, with five bounded health probes; SSM execution timeout is 40 seconds and delivery timeout is 30 seconds.
7. Later scheduled checks inspect command status/exit code/known result marker and recheck proxy health. Only a completed guarded start plus healthy external API probe produces `Start Store API verified` remediation success. Skips are health events. Proxy failures after a start are not labelled successful recovery. Command IDs are retained in completion audit records.
8. A maximum of three guarded commands is allowed before FAILED/operator review. These attempts include diagnostic commands that skip a start. A confirmed healthy episode resets the budget; the last-attempt cooldown still applies. An uncertain dispatch or missing result beyond 180 seconds keeps a pending marker and blocks replacement commands until the result is resolved or an operator intervenes. Automatic SDK retries are disabled for SSM dispatch to avoid an ambiguous duplicate SendCommand.

Existing CloudOps state and audit displays read the same tables. `recovery_requested` is an initiation event, not proof of success. `health_observed` records the latest HTTP check separately from workflow status; RECOVERING/FAILED can reflect command uncertainty. Existing health-score and state freshness limitations are not broadened into guarantees.

## Owner deployment and activation

1. Download the current `self-healing-health-manager` function code ZIP and save the current role policy as backups.
2. Temporarily set `APP_RECOVERY_ENABLED=false` so scheduled checks cannot dispatch while the document, policy, and function are being updated.
3. Create the Systems Manager **Command** document using `lambda/store_api_recovery_document.json`, with the exact name `self-healing-start-store-api` in the selected Region.
4. Upload `store-api-alert-only-restricted-recovery-2026-10-18.zip` through Lambda Code source and preserve the function settings. This revision keeps guarded Store API recovery, but makes EC2 health checks alert-only; it does not reboot EC2. The package logs command submission and terminal status.
5. Update the Health Manager role policy to match `lambda/health_manager_inline_policy_alert_only.json`: remove `dynamodb:UpdateItem` and the `RebootProjectInstance` statement; keep EC2 describe, targeted SSM document dispatch, SSM result read, DynamoDB get/put, logs, and ops SNS. The SSM resources remain limited to the selected EC2 instance ARN and `arn:aws:ssm:us-east-1:325381793128:document:self-healing-start-store-api`. Keep `ssm:GetCommandInvocation` on `*`; AWS does not support resource scoping for that read action.
6. Confirm the document has no parameters, the function name matches, and the role policy no longer permits `AWS-RunShellScript`. Then set `APP_RECOVERY_ENABLED=true` when ready to resume automatic starts.
7. A deliberate outage test briefly interrupts the API. When ready, stop the Store API once and verify the log shows a submitted command followed by a terminal result and external health verification. The dashboard should record `Start Store API verified` as `RECOVERED`.

The prepared ZIP and Terraform configuration are not deployed by the assistant. A Terraform apply may include unrelated drift; review its plan before applying and avoid applying memory-agent user-data changes that would replace the EC2 instance unless that replacement is separately intended.

The dashboard Maintenance switch currently disables CloudWatch alarm actions; it does not pause Health Manager process recovery. Set `APP_RECOVERY_ENABLED=false` before intentionally stopping the API for maintenance. Disabling it stops new dispatches but does not cancel an already accepted SSM command; inspect and wait for pending commands to finish before maintenance.

## Verification and rollback

The prior targeted-recovery revision passed 47 Lambda tests, including seven real-Bash control-flow scenarios with stubbed system commands. The custom-document revision changes the command-dispatch contract and its existing test expectations; it has not been tested. No AWS changes were made by the assistant. The owner previously verified recovery using `AWS-RunShellScript`; the new custom document and restricted policy still require owner deployment and a controlled verification.

To roll back, first disable new dispatch with the flag and inspect any pending SSM command. Once commands have reached terminal states, restore the saved monitor-only ZIP (the prepared `store-api-health-monitor-2026-10-17.zip` is also retained). Do not erase an uncertain pending command/version to force a retry; pause the schedule, inspect SSM history for the instance, and resolve its outcome first. Resume with consistent state only after review.

## AWS references

- [GetCommandInvocation and eventual consistency](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html)
- [Run Command statuses and timeouts](https://docs.aws.amazon.com/systems-manager/latest/userguide/monitor-commands.html)
