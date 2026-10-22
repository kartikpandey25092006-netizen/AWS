import json
import os
import datetime
import urllib.request
import boto3
from botocore.config import Config

dynamodb = boto3.resource("dynamodb")
ec2_client = boto3.client("ec2")
# SendCommand has no idempotency token. Do not automatically repeat an
# ambiguous dispatch; persistent state below requires operator review instead.
ssm_client = boto3.client("ssm", config=Config(
    connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 1}))
sns_client = boto3.client("sns")

STATE_TABLE = os.environ.get("STATE_TABLE")
AUDIT_TABLE = os.environ.get("AUDIT_TABLE")
OPS_TOPIC_ARN = os.environ.get("OPS_TOPIC_ARN")
INSTANCE_ID = os.environ.get("INSTANCE_ID")
STORE_API_RECOVERY_DOCUMENT = os.environ.get("STORE_API_RECOVERY_DOCUMENT", "")
MAX_ATTEMPTS = 3
STABILIZATION_TIME_SECONDS = 60
APP_RECOVERY_ENABLED = os.environ.get("APP_RECOVERY_ENABLED", "false") == "true"
APP_RECOVERY_COOLDOWN_SECONDS = 120
APP_COMMAND_DEADLINE_SECONDS = 180

state_table = dynamodb.Table(STATE_TABLE)
audit_table = dynamodb.Table(AUDIT_TABLE)

def _utc_timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def get_state(resource_id):
    try:
        resp = state_table.get_item(Key={"resource_id": resource_id})
        if "Item" in resp:
            return resp["Item"]
    except Exception as e:
        print(f"Error fetching state: {e}")
    
    return {
        "resource_id": resource_id,
        "status": "HEALTHY",
        "attempts": 0,
        "last_attempt_time": "1970-01-01T00:00:00+00:00",
        "problem": ""
    }

def update_state(state):
    try:
        state_table.put_item(Item=state)
    except Exception as e:
        print(f"Error updating state: {e}")

def log_audit_event(event_type, action, problem, success, attempt, error=None, command_id=None):
    entry = {
        "instance_id": INSTANCE_ID,
        "timestamp": _utc_timestamp(),
        "event_type": event_type,
        "action": action,
        "problem": problem,
        "success": success,
        "attempt": attempt
    }
    if error:
        entry["error"] = error
    if command_id:
        entry["command_id"] = command_id
    try:
        audit_table.put_item(Item=entry)
        return True
    except Exception as e:
        print(f"Error logging audit: {e}")
        return False

def send_sns(subject, message):
    try:
        sns_client.publish(
            TopicArn=OPS_TOPIC_ARN,
            Subject=subject,
            Message=message
        )
    except Exception as e:
        print(f"Error sending SNS: {e}")

def check_ec2_health():
    try:
        resp = ec2_client.describe_instance_status(InstanceIds=[INSTANCE_ID])
        if not resp["InstanceStatuses"]:
            return False, "Instance not found or stopped"
        status = resp["InstanceStatuses"][0]
        sys_status = status["SystemStatus"]["Status"]
        inst_status = status["InstanceStatus"]["Status"]
        if sys_status != "ok":
            return False, "EC2 System Status Check Failed"
        if inst_status != "ok":
            return False, "EC2 Instance Status Check Failed"
        return True, ""
    except Exception as e:
        print(f"Error checking EC2 health: {e}")
        return False, f"Error checking EC2 health: {str(e)}"

def get_instance_ip():
    try:
        resp = ec2_client.describe_instances(InstanceIds=[INSTANCE_ID])
        return resp["Reservations"][0]["Instances"][0].get("PublicIpAddress")
    except Exception as e:
        print(f"Error fetching instance IP: {e}")
        return None

def check_app_health():
    ip = get_instance_ip()
    if not ip:
        return False, "Could not determine instance IP"
    url = f"http://{ip}/store-api/health"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status != 200:
                return False, f"Store API health returned HTTP {response.status}"
            # A static Nginx page or HTML fallback must not count as API health.
            body = response.read(4097)
            if len(body) > 4096:
                return False, "Store API health response was too large"
            payload = json.loads(body)
            if not isinstance(payload, dict) or payload.get("status") != "ok":
                return False, "Store API health response was invalid"
            return True, ""
    except Exception as e:
        print(f"Error checking app health: {e}")
        return False, f"Store API health check failed: {type(e).__name__}"

def process_resource(resource_id, check_func, recovery_action_func, recovery_name):
    print(f"Processing {resource_id}...")
    is_healthy, problem_desc = check_func()
    state = get_state(resource_id)

    # Observe application liveness before introducing a new recovery policy.
    # A proxy/network failure alone is not evidence that Node needs a restart.
    if recovery_action_func is None:
        previous_status = state.get("status", "UNKNOWN")
        status = "HEALTHY" if is_healthy else "UNHEALTHY"
        state.update(status=status, problem=problem_desc, attempts=0,
                     checked_at=_utc_timestamp())
        if resource_id == "store-api":
            state["health_path"] = "/store-api/health"
        else:
            state.pop("health_path", None)
        update_state(state)
        if status != previous_status:
            log_audit_event("health", recovery_name, problem_desc, is_healthy, 0)
            resource_label = "STORE API" if resource_id == "store-api" else "EC2 HEALTH"
            send_sns(f"{resource_label} RESTORED" if is_healthy else f"{resource_label} ALERT",
                     f"Instance: {INSTANCE_ID}\nStatus: {status}\nProblem: {problem_desc or 'None'}\nMode: monitoring only")
        return
    
    current_status = state["status"]
    attempts = int(state.get("attempts", 0))
    last_attempt_time = state.get("last_attempt_time", "1970-01-01T00:00:00+00:00")
    
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        last_dt = datetime.datetime.fromisoformat(last_attempt_time)
    except:
        last_dt = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
        
    seconds_since_last = (now - last_dt).total_seconds()

    if is_healthy:
        if current_status in ["RECOVERING", "FAILED", "UNHEALTHY"]:
            # State transition to healthy
            state["status"] = "HEALTHY"
            state["attempts"] = 0
            update_state(state)
            
            # Send Success SNS
            subject = "RESILIENTAI RECOVERY SUCCESS"
            msg = f"RESILIENTAI RECOVERY SUCCESS\n\nInstance: {INSTANCE_ID}\nResource: {resource_id}\nProblem: {state.get('problem', 'Unknown')}\nAction: Automatic Recovery\nAttempts: {attempts}\nFinal Status: HEALTHY"
            send_sns(subject, msg)
            
            log_audit_event(
                event_type="remediation",
                action="Verification",
                problem=state.get('problem', 'Unknown'),
                success=True,
                attempt=attempts
            )
            print(f"[{resource_id}] Recovered successfully!")
        return

    # If we reach here, it is UNHEALTHY
    if current_status == "FAILED":
        print(f"[{resource_id}] Still FAILED. Waiting for admin intervention.")
        return
        
    if current_status == "RECOVERING" and seconds_since_last < STABILIZATION_TIME_SECONDS:
        print(f"[{resource_id}] Still waiting for stabilization ({seconds_since_last}s elapsed)")
        return

    # Needs recovery action
    if attempts >= MAX_ATTEMPTS:
        # Reached max attempts
        state["status"] = "FAILED"
        update_state(state)
        
        subject = "RESILIENTAI CRITICAL ALERT"
        msg = f"RESILIENTAI CRITICAL ALERT\n\nInstance: {INSTANCE_ID}\nResource: {resource_id}\nProblem: {problem_desc}\nRecovery Attempts: {attempts}\nFinal Status: FAILED\nAdministrator Intervention Required"
        send_sns(subject, msg)
        
        log_audit_event("remediation", recovery_name, problem_desc, False, attempts)
        print(f"[{resource_id}] Max attempts reached. Marked as FAILED.")
        return

    # Trigger recovery
    attempts += 1
    state["status"] = "RECOVERING"
    state["attempts"] = attempts
    state["last_attempt_time"] = _utc_timestamp()
    state["problem"] = problem_desc
    update_state(state)
    
    subject = "RESILIENTAI ALERT"
    msg = f"RESILIENTAI ALERT\n\nInstance: {INSTANCE_ID}\nResource: {resource_id}\nProblem: {problem_desc}\nAction: Automatic Recovery Initiated\nAttempt: {attempts}\nStatus: RECOVERING"
    send_sns(subject, msg)
    
    try:
        recovery_action_func()
        log_audit_event("remediation", recovery_name, problem_desc, True, attempts)
        print(f"[{resource_id}] Recovery action initiated (Attempt {attempts})")
    except Exception as e:
        log_audit_event("remediation", recovery_name, problem_desc, False, attempts, str(e))
        print(f"[{resource_id}] Recovery action failed: {e}")

def _app_state_commit(previous, updated):
    """Compare-and-set prevents overlapping scheduled invocations dispatching twice."""
    version = previous.get("recovery_version")
    updated = {**updated, "resource_id": "app-health", "recovery_version": int(version or 0) + 1}
    request = {"Item": updated, "ExpressionAttributeNames": {"#v": "recovery_version"}}
    if version is None:
        request["ConditionExpression"] = "attribute_not_exists(#v)"
    else:
        request["ConditionExpression"] = "#v = :v"
        request["ExpressionAttributeValues"] = {":v": version}
    try:
        state_table.put_item(**request)
        return updated
    except Exception as error:
        print(f"Store API state update rejected; no further action: {type(error).__name__}")
        return None


def _app_age(timestamp, now):
    parsed = datetime.datetime.fromisoformat(timestamp)
    if parsed.tzinfo is None:
        raise ValueError("Recovery timestamps must include a timezone")
    return (now - parsed).total_seconds()


def process_store_api():
    healthy, problem = check_app_health()
    try:
        state = state_table.get_item(Key={"resource_id": "app-health"}, ConsistentRead=True).get("Item", {})
        attempts = int(state.get("attempts", 0))
        if attempts < 0:
            raise ValueError("Invalid attempt count")
    except Exception as error:
        print(f"Store API recovery skipped: state unavailable ({type(error).__name__})")
        return
    now = datetime.datetime.now(datetime.timezone.utc)
    observed = {**state, "checked_at": now.isoformat(), "health_path": "/store-api/health",
                "health_observed": healthy, "problem": problem,
                "recovery_enabled": APP_RECOVERY_ENABLED, "attempts": attempts}

    def finish(status, description=None, action=None, success=False, event_type="health"):
        updated = {**observed, "status": status}
        if description is not None:
            updated["problem"] = description
        if _app_state_commit(state, updated):
            if action or status != state.get("status"):
                log_audit_event(event_type, action or "Store API health check", updated["problem"],
                                success if action else healthy, updated["attempts"],
                                command_id=state.get("ssm_command_id"))
                send_sns("STORE API STATUS UPDATE", f"Instance: {INSTANCE_ID}\nStatus: {status}\nProblem: {updated['problem'] or 'None'}")

    # Always resolve pending work, including when new recovery has been disabled.
    if state.get("recovery_phase"):
        try:
            age = _app_age(state["command_started_at"], now)
        except (KeyError, TypeError, ValueError):
            finish("FAILED", "Invalid pending recovery state; operator review required")
            return
        result = None
        if state.get("ssm_command_id"):
            try:
                result = ssm_client.get_command_invocation(CommandId=state["ssm_command_id"], InstanceId=INSTANCE_ID)
            except Exception as error:
                # SSM invocation visibility is eventually consistent. Never
                # dispatch a replacement while the first result is uncertain.
                print(f"Store API command result unavailable: {type(error).__name__}")
        if result and result.get("Status") in {"Success", "Failed", "Cancelled", "TimedOut"}:
            for key in ("recovery_phase", "ssm_command_id", "command_started_at"):
                observed.pop(key, None)
            print(f"Store API recovery command completed: status={result.get('Status')} response_code={result.get('ResponseCode')}")
            marker = result.get("StandardOutputContent", "").strip().splitlines()
            marker = marker[-1] if marker else ""
            if result["Status"] == "Success" and result.get("ResponseCode") == 0 and marker == "STORE_API_STARTED":
                if healthy:
                    observed["attempts"] = 0
                    print("Store API recovery verified by the external health check")
                    finish("HEALTHY", "", "Start Store API verified", True, "remediation")
                else:
                    finish("UNHEALTHY", "Store API start completed, but proxy health still fails", "Start Store API; proxy verification failed", False, "remediation")
            elif result["Status"] == "Success" and result.get("ResponseCode") == 0 and marker in {"STORE_API_ACTIVE", "STORE_API_BUSY", "STORE_API_DISABLED"}:
                if healthy:
                    observed["attempts"] = 0
                finish("HEALTHY" if healthy else "UNHEALTHY",
                       "" if healthy else f"No service start: {marker}; inspect application/proxy/connectivity",
                       "Store API recovery skipped", healthy)
            else:
                finish("HEALTHY" if healthy else ("FAILED" if attempts >= MAX_ATTEMPTS else "UNHEALTHY"),
                       "" if healthy else f"Store API command ended with {result.get('Status')}; no verified recovery",
                       "Store API recovery command failed", False, "remediation")
            return
        if age > APP_COMMAND_DEADLINE_SECONDS or age < 0:
            # Preserve the unresolved command/phase: no automatic replacement
            # may run until an operator determines what happened.
            finish("FAILED", "Recovery result uncertain; operator review required")
        else:
            finish("RECOVERING", "Waiting for the existing Store API recovery command")
        return

    if healthy:
        observed["attempts"] = 0
        finish("HEALTHY", "")
        return
    if not APP_RECOVERY_ENABLED:
        finish("UNHEALTHY")
        return
    if not STORE_API_RECOVERY_DOCUMENT:
        print("Store API recovery document is not configured; no command sent")
        finish("UNHEALTHY", "Store API recovery document is not configured; no command sent")
        return
    if state.get("status") == "FAILED" or attempts >= MAX_ATTEMPTS:
        finish("FAILED", "Store API recovery limit reached; operator review required")
        return
    try:
        age = _app_age(state.get("last_attempt_time", "1970-01-01T00:00:00+00:00"), now)
    except (TypeError, ValueError):
        finish("FAILED", "Invalid recovery timestamp; operator review required")
        return
    if age < APP_RECOVERY_COOLDOWN_SECONDS:
        finish("UNHEALTHY", "Store API recovery cooldown; no new command sent")
        return
    ec2_healthy, _ = check_ec2_health()
    if not ec2_healthy:
        finish("UNHEALTHY", "EC2 health is not confirmed; Store API recovery deferred")
        return

    reserved = _app_state_commit(state, {**observed, "status": "RECOVERING", "attempts": attempts + 1,
        "last_attempt_time": now.isoformat(), "command_started_at": now.isoformat(), "recovery_phase": "dispatching"})
    if reserved is None:
        return
    if not log_audit_event("recovery_requested", "Guarded Store API start requested", problem, False, attempts + 1):
        _app_state_commit(reserved, {**reserved, "status": "FAILED", "problem": "Recovery audit unavailable; no command sent"})
        return
    try:
        response = ssm_client.send_command(
            InstanceIds=[INSTANCE_ID], DocumentName=STORE_API_RECOVERY_DOCUMENT,
            TimeoutSeconds=30, Comment="Guarded Store API process recovery")
        command_id = response["Command"]["CommandId"]
        if not isinstance(command_id, str) or not command_id:
            raise ValueError("Missing command ID")
        print(f"Store API recovery command submitted: {command_id}")
    except Exception as error:
        # The request might have reached SSM before a timeout. Preserve the lease
        # rather than risk a repeated root command after an ambiguous failure.
        _app_state_commit(reserved, {**reserved, "status": "FAILED",
            "problem": "Recovery dispatch unconfirmed; operator review required"})
        log_audit_event("remediation", "Store API dispatch unconfirmed", problem, False, attempts + 1, type(error).__name__)
        return
    _app_state_commit(reserved, {**reserved, "recovery_phase": "pending", "ssm_command_id": command_id})

def handler(event, context):
    print(f"Running self-healing health manager... (Max attempts: {MAX_ATTEMPTS})")
    
    # 1. Process EC2 Health
    process_resource(
        resource_id="ec2-health",
        check_func=check_ec2_health,
        recovery_action_func=None,
        recovery_name="EC2 health monitoring (alert-only)"
    )
    
    # 2. Process App Health
    process_store_api()
    
    print("Health manager complete.")
    return {"statusCode": 200, "body": "OK"}
