"""
Self-Healing Lambda Function
─────────────────────────────
Handles TWO event sources:

1. SNS alarms: CPU and memory produce operator alerts; other alarms are
   audited as skipped. This function issues no SSM commands.

2. EventBridge (EC2 State Change) → Logs instance lifecycle events
   (start, stop, terminate, reboot) to S3 for audit trail.
"""

import json
import os
import datetime
import boto3
import urllib.request

# ── Clients (initialised outside handler for connection reuse) ────────────
s3_client = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

# ── Environment variables injected by Terraform ──────────────────────────
AUDIT_BUCKET = os.environ["AUDIT_BUCKET"]
DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")


def handler(event, context):
    """Entry-point: routes to the appropriate handler based on event source."""

    print(f"Received event: {json.dumps(event)}")

    # ── Route by event source ─────────────────────────────────────────────
    if "Records" in event and len(event["Records"]) > 0:
        record = event["Records"][0]
        if "Sns" in record:
            return _handle_sns_alarm(event)

    if event.get("source") == "aws.ec2":
        return _handle_ec2_state_change(event)

    print(f"WARN  Unknown event type – skipping. Keys: {list(event.keys())}")
    return {"action": "skipped", "reason": "Unknown event type"}


# ─────────────────────────────────────────────────────────────────────────────
# Handler 1: SNS → CloudWatch Alarm → Remediation
# ─────────────────────────────────────────────────────────────────────────────

def _handle_sns_alarm(event: dict) -> dict:
    """Record resource alerts or skip unrecognized alarms without commands."""

    # ── 1. Parse the SNS → CloudWatch Alarm payload ──────────────────────
    try:
        sns_record = event["Records"][0]["Sns"]
        alarm_data = json.loads(sns_record["Message"])
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        print(f"ERROR  Failed to parse SNS/Alarm payload: {exc}")
        raise

    alarm_name = alarm_data.get("AlarmName", "unknown")
    new_state = alarm_data.get("NewStateValue", "unknown")
    reason = alarm_data.get("NewStateReason", "unknown")

    print(f"Alarm: {alarm_name} | State: {new_state} | Reason: {reason}")

    # Only act on ALARM state (ignore OK / INSUFFICIENT_DATA)
    if new_state != "ALARM":
        print("State is not ALARM – skipping remediation.")
        return {"action": "skipped", "reason": f"State was {new_state}"}

    # ── 2. Extract Instance ID from alarm dimensions ─────────────────────
    instance_id = _extract_instance_id(alarm_data)
    if not instance_id:
        msg = "No InstanceId dimension found in alarm payload."
        print(f"ERROR  {msg}")
        raise ValueError(msg)

    print(f"Target instance for remediation: {instance_id}")

    # Resource pressure does not identify a safe process to terminate or restart.
    metric_name = alarm_data.get("Trigger", {}).get("MetricName", "")
    memory_alarm = metric_name == "mem_used_percent" or "memory" in alarm_name.lower()
    cpu_alarm = metric_name == "CPUUtilization" or "cpu" in alarm_name.lower()
    if memory_alarm or cpu_alarm:
        resource_label = "memory" if memory_alarm else "CPU"
        audit_prefix = "memory-alerts" if memory_alarm else "cpu-alerts"
        timestamp = _utc_timestamp()
        audit_entry = {
            "event_type": "alarm",
            "timestamp": timestamp,
            "instance_id": instance_id,
            "action": f"High {resource_label} alert - operator review required",
            "alarm_name": alarm_name,
            "alarm_reason": reason,
            "problem": reason,
            "outcome": "ATTENTION_REQUIRED",
            "health_check_status": "NOT_CHECKED",
        }
        _write_audit_log(audit_prefix, timestamp, instance_id, audit_entry)
        _send_discord_alert(
            f"High {resource_label} alarm: {alarm_name}\nInstance: {instance_id}\n"
            f"Reason: {reason[:500]}\nOperator review required. "
            "No process was terminated and no service was restarted. "
            f"{resource_label.capitalize()} recovery has not been verified."
        )
        return audit_entry

    timestamp = _utc_timestamp()
    audit_entry = {
        "event_type": "alarm_skipped",
        "timestamp": timestamp,
        "instance_id": instance_id,
        "action": "Unrecognized alarm skipped",
        "alarm_name": alarm_name,
        "alarm_reason": reason,
        "outcome": "SKIPPED",
        "health_check_status": "NOT_CHECKED",
        "reason": "No handler is configured for this alarm; no command was sent.",
    }
    _write_audit_log("skipped-alarms", timestamp, instance_id, audit_entry)
    print("Unrecognized alarm skipped; no command was sent.")
    return audit_entry


# ─────────────────────────────────────────────────────────────────────────────
# Handler 2: EventBridge → EC2 State Change → Lifecycle Audit Log
# ─────────────────────────────────────────────────────────────────────────────

def _handle_ec2_state_change(event: dict) -> dict:
    """Log EC2 instance state transitions (start/stop/terminate) to S3."""

    detail = event.get("detail", {})
    instance_id = detail.get("instance-id", "unknown")
    new_state = detail.get("state", "unknown")
    event_time = event.get("time", "unknown")
    account = event.get("account", "unknown")
    region = event.get("region", "unknown")

    print(f"EC2 State Change: {instance_id} → {new_state}")

    timestamp = _utc_timestamp()
    audit_entry = {
        "event_type": "lifecycle",
        "timestamp": timestamp,
        "event_time": event_time,
        "instance_id": instance_id,
        "new_state": new_state,
        "account": account,
        "region": region,
        "detail_type": event.get("detail-type", "unknown"),
    }

    _write_audit_log("lifecycle-logs", timestamp, instance_id, audit_entry)
    return audit_entry


# ─────────────────────────────────────────────────────────────────────────────
# Shared Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _send_discord_alert(message: str) -> None:
    """Send a ChatOps alert to a Discord Webhook."""
    if not DISCORD_WEBHOOK_URL:
        return
    req = urllib.request.Request(DISCORD_WEBHOOK_URL, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "SelfHealingBot/1.0")
    data = json.dumps({"content": message}).encode("utf-8")
    try:
        urllib.request.urlopen(req, data=data, timeout=5)
        print("Discord alert sent successfully.")
    except Exception as exc:
        print(f"WARN  Failed to send Discord alert: {exc}")

def _utc_timestamp() -> str:
    """Return current UTC time as an ISO 8601 string."""
    return datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def _extract_instance_id(alarm_data: dict) -> str | None:
    """Pull the InstanceId value from the CloudWatch Alarm dimensions."""
    dimensions = alarm_data.get("Trigger", {}).get("Dimensions", [])
    for dim in dimensions:
        if dim.get("name") == "InstanceId":
            return dim["value"]
    return None


def _write_audit_log(
    prefix: str, timestamp: str, instance_id: str, entry: dict
) -> None:
    """Write a JSON audit entry to S3 under the given prefix and to DynamoDB."""
    s3_key = f"{prefix}/{timestamp.replace(':', '-')}-{instance_id}.json"

    try:
        s3_client.put_object(
            Bucket=AUDIT_BUCKET,
            Key=s3_key,
            Body=json.dumps(entry, indent=2),
            ContentType="application/json",
        )
        print(f"Audit log written → s3://{AUDIT_BUCKET}/{s3_key}")
    except Exception as exc:
        print(f"ERROR  Failed to write audit log to S3: {exc}")

    if DYNAMODB_TABLE:
        try:
            table = dynamodb.Table(DYNAMODB_TABLE)
            # DynamoDB requires strings, numbers, etc. JSON dump for nested dicts if needed.
            table.put_item(Item=entry)
            print(f"Audit log written → DynamoDB Table: {DYNAMODB_TABLE}")
        except Exception as exc:
            print(f"ERROR  Failed to write audit log to DynamoDB: {exc}")
