import os
import json
import boto3
import datetime
import math
from decimal import Decimal
from boto3.dynamodb.conditions import Key

# ── Clients (initialised outside handler for connection reuse) ────────────
cloudwatch = boto3.client("cloudwatch")
ec2 = boto3.client("ec2")
dynamodb = boto3.resource("dynamodb")

INSTANCE_ID = os.environ.get("INSTANCE_ID")
DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE")
STATE_TABLE = os.environ.get("STATE_TABLE")

def handler(event, context):
    raw_path = event.get('rawPath', '')
    method = event.get('requestContext', {}).get('http', {}).get('method', 'GET')
    print(f"Received API request: {method} {raw_path}")

    try:
        if raw_path == "/api/maintenance" and method == "POST":
            body = json.loads(event.get("body", "{}"))
            maintenance_mode = body.get("maintenance", False)

            alarms = cloudwatch.describe_alarms(AlarmNamePrefix="self-healing")["MetricAlarms"]
            alarm_names = [a["AlarmName"] for a in alarms]

            if alarm_names:
                if maintenance_mode:
                    cloudwatch.disable_alarm_actions(AlarmNames=alarm_names)
                else:
                    cloudwatch.enable_alarm_actions(AlarmNames=alarm_names)

            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"success": True, "maintenance": maintenance_mode, "alarms_updated": len(alarm_names)})
            }

        else: # GET /api/status
            time_range = event.get("queryStringParameters", {}).get("time_range", "40m") if event.get("queryStringParameters") else "40m"

            uptime_seconds = get_uptime(INSTANCE_ID)
            cpu_history, current_cpu, is_simulating = get_cpu_metrics(INSTANCE_ID, time_range)
            memory_history, current_memory, is_memory_simulating = get_memory_metrics(INSTANCE_ID, time_range)
            audit_logs = get_audit_logs(INSTANCE_ID)
            healing_state = get_healing_state()

            alarms = cloudwatch.describe_alarms(AlarmNamePrefix="self-healing")["MetricAlarms"]
            maintenance_mode = any(a.get("ActionsEnabled") == False for a in alarms)

            body = {
                "uptime": uptime_seconds,
                "cpu_history": cpu_history,
                "current_cpu": current_cpu,
                "is_simulating": is_simulating,
                "memory_history": memory_history,
                "current_memory": current_memory,
                "is_memory_simulating": is_memory_simulating,
                "audit_logs": audit_logs,
                "maintenance_mode": maintenance_mode,
                "healing_state": healing_state,
                "health_score": compute_health_score(
                    cpu=current_cpu,
                    memory=current_memory,
                    uptime_seconds=uptime_seconds,
                    cpu_history=cpu_history,
                    memory_history=memory_history,
                    healing_state=healing_state
                )
            }

            return {
                "statusCode": 200,
                "headers": {
                    "Content-Type": "application/json"
                },
                "body": json.dumps(body, cls=DecimalEncoder)
            }

    except Exception as e:
        print(f"API Error: {e}")
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json"
            },
            "body": json.dumps({"error": str(e)})
        }


def get_uptime(instance_id):
    try:
        response = ec2.describe_instances(InstanceIds=[instance_id])
        instance = response["Reservations"][0]["Instances"][0]
        launch_time = instance["LaunchTime"]
        now = datetime.datetime.now(datetime.timezone.utc)
        uptime = (now - launch_time).total_seconds()
        return int(uptime)
    except Exception as e:
        print(f"Error fetching uptime: {e}")
        return 0

def get_cpu_metrics(instance_id, time_range="40m"):
    try:
        end_time = datetime.datetime.now(datetime.timezone.utc)
        
        if time_range == "24h":
            start_time = end_time - datetime.timedelta(hours=24)
            period = 3600
            num_points = 24
        elif time_range == "1h":
            start_time = end_time - datetime.timedelta(hours=1)
            period = 180
            num_points = 20
        else: # default 40m
            start_time = end_time - datetime.timedelta(minutes=40)
            period = 120
            num_points = 20
        
        response = cloudwatch.get_metric_statistics(
            Namespace="AWS/EC2",
            MetricName="CPUUtilization",
            Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
            StartTime=start_time,
            EndTime=end_time,
            Period=period,
            Statistics=["Average"]
        )
        
        datapoints = response.get("Datapoints", [])
        # Sort by timestamp ascending
        datapoints.sort(key=lambda x: x["Timestamp"])
        
        # Format for frontend
        history = []
        for dp in datapoints:
            history.append({
                "time": dp["Timestamp"].isoformat(),
                "cpu": round(dp["Average"], 1)
            })
            
        # Ensure we always have enough points for the graph by padding with 0s if needed
        while len(history) < num_points:
            history.insert(0, {"time": "", "cpu": 0})
            
        # Take exactly the last num_points
        history = history[-num_points:]
        
        current_cpu = history[-1]["cpu"] if history else 0
        is_simulating = current_cpu > 75.0
        
        return history, current_cpu, is_simulating
    except Exception as e:
        print(f"Error fetching CPU: {e}")
        num_points = 24 if time_range == "24h" else 20
        history = [{"time": "", "cpu": 0} for _ in range(num_points)]
        return history, 0, False

def get_memory_metrics(instance_id, time_range="40m"):
    try:
        end_time = datetime.datetime.now(datetime.timezone.utc)
        
        if time_range == "24h":
            start_time = end_time - datetime.timedelta(hours=24)
            period = 3600
            num_points = 24
        elif time_range == "1h":
            start_time = end_time - datetime.timedelta(hours=1)
            period = 180
            num_points = 20
        else: # default 40m
            start_time = end_time - datetime.timedelta(minutes=40)
            period = 120
            num_points = 20
        
        response = cloudwatch.get_metric_statistics(
            Namespace="CWAgent",
            MetricName="mem_used_percent",
            Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
            StartTime=start_time,
            EndTime=end_time,
            Period=period,
            Statistics=["Average"]
        )
        
        datapoints = response.get("Datapoints", [])
        # Sort by timestamp ascending
        datapoints.sort(key=lambda x: x["Timestamp"])
        
        # Format for frontend
        history = []
        for dp in datapoints:
            history.append({
                "time": dp["Timestamp"].isoformat(),
                "memory": round(dp["Average"], 1)
            })
            
        # Ensure we always have enough points for the graph by padding with 0s if needed
        while len(history) < num_points:
            history.insert(0, {"time": "", "memory": 0})
            
        # Take exactly the last num_points
        history = history[-num_points:]
        
        current_memory = history[-1]["memory"] if history else 0
        is_memory_simulating = current_memory > 85.0
        
        return history, current_memory, is_memory_simulating
    except Exception as e:
        print(f"Error fetching Memory: {e}")
        num_points = 24 if time_range == "24h" else 20
        history = [{"time": "", "memory": 0} for _ in range(num_points)]
        return history, 0, False

def get_audit_logs(instance_id, limit=50):
    table = dynamodb.Table(DYNAMODB_TABLE)
    now = datetime.datetime.now(datetime.timezone.utc)
    twenty_four_hours_ago = (now - datetime.timedelta(hours=24)).isoformat()
    
    try:
        response = table.query(
            KeyConditionExpression=Key("instance_id").eq(instance_id) & Key("timestamp").gte(twenty_four_hours_ago),
            ScanIndexForward=False, # descending order
            Limit=limit
        )
        return response.get("Items", [])
    except Exception as e:
        print(f"DynamoDB query failed: {e}")
        return []

def get_healing_state():
    if not STATE_TABLE:
        return {}
    
    table = dynamodb.Table(STATE_TABLE)
    try:
        # Fetch both ec2-health and app-health
        states = {}
        for rid in ["ec2-health", "app-health"]:
            resp = table.get_item(Key={"resource_id": rid})
            if "Item" in resp:
                states[rid] = resp["Item"]
            else:
                states[rid] = {"status": "UNKNOWN", "attempts": 0}
        return states
    except Exception as e:
        print(f"Error fetching state: {e}")
        return {}

# Custom JSON encoder to handle DynamoDB Decimals
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 > 0:
                return float(obj)
            else:
                return int(obj)
        return super(DecimalEncoder, self).default(obj)


# ─────────────────────────────────────────────────────────────────────────────
# Custom Health Score Engine (0–100)
# ─────────────────────────────────────────────────────────────────────────────
# This is a CUSTOM-BUILT composite scoring algorithm.
# AWS does NOT provide a single "health score" — it only gives raw metrics.
# This engine normalises CPU, Memory, Uptime Stability, Metric Volatility,
# and Healing State into a single actionable score from 0 (critical) to
# 100 (perfectly healthy), using weighted averages and penalty curves.
# ─────────────────────────────────────────────────────────────────────────────

# Weights must sum to 1.0
HEALTH_WEIGHTS = {
    "cpu":        0.30,   # 30% — current CPU utilisation
    "memory":     0.25,   # 25% — current memory utilisation
    "uptime":     0.15,   # 15% — uptime stability (recent reboots penalised)
    "volatility": 0.15,   # 15% — metric volatility (spikes penalised)
    "healing":    0.15,   # 15% — recent healing activity (incidents penalised)
}

def compute_health_score(
    cpu: float,
    memory: float,
    uptime_seconds: int,
    cpu_history: list,
    memory_history: list,
    healing_state: dict
) -> dict:
    """Compute a composite health score from 0 (critical) to 100 (healthy).
    
    Returns a dict with the overall score, per-component scores, letter grade,
    and a human-readable status label.
    """

    # ── 1. CPU Score (100 = idle, 0 = maxed out) ─────────────────────────
    # Uses inverse exponential: light loads barely reduce score,
    # but loads above 80% drop the score aggressively.
    cpu_score = max(0, 100 - (cpu ** 1.5) / 10)
    cpu_score = round(min(100, cpu_score), 1)

    # ── 2. Memory Score (same curve as CPU) ──────────────────────────────
    mem_score = max(0, 100 - (memory ** 1.5) / 10)
    mem_score = round(min(100, mem_score), 1)

    # ── 3. Uptime Stability Score ────────────────────────────────────────
    # Full score after 1 hour of continuous uptime.
    # A freshly rebooted instance (< 5 min) gets a low score,
    # indicating a possible recent crash/recovery.
    if uptime_seconds >= 3600:
        uptime_score = 100.0
    elif uptime_seconds <= 0:
        uptime_score = 0.0
    else:
        # Logarithmic curve: fast climb at first, then flattens
        uptime_score = round(min(100, (math.log(uptime_seconds + 1) / math.log(3601)) * 100), 1)

    # ── 4. Metric Volatility Score ───────────────────────────────────────
    # Measures standard deviation of recent CPU & memory values.
    # High volatility (wild swings) = unstable system = lower score.
    cpu_values = [dp.get("cpu", 0) for dp in cpu_history if dp.get("cpu", 0) > 0]
    mem_values = [dp.get("memory", 0) for dp in memory_history if dp.get("memory", 0) > 0]

    cpu_stddev = _stddev(cpu_values) if len(cpu_values) > 1 else 0
    mem_stddev = _stddev(mem_values) if len(mem_values) > 1 else 0
    combined_stddev = (cpu_stddev + mem_stddev) / 2

    # Map stddev 0–40 to score 100–0
    volatility_score = max(0, 100 - (combined_stddev * 2.5))
    volatility_score = round(min(100, volatility_score), 1)

    # ── 5. Healing State Score ───────────────────────────────────────────
    # If the system recently healed itself, penalise the score.
    # A system that hasn't needed healing = 100.
    healing_score = 100.0
    for key, state in healing_state.items():
        status = state.get("status", "UNKNOWN") if isinstance(state, dict) else "UNKNOWN"
        attempts = int(state.get("attempts", 0)) if isinstance(state, dict) else 0
        if status in ["DEGRADED", "RECOVERING"]:
            healing_score -= 30
        if attempts > 0:
            healing_score -= min(40, attempts * 15)
    healing_score = round(max(0, min(100, healing_score)), 1)

    # ── Weighted Composite Score ─────────────────────────────────────────
    overall = (
        HEALTH_WEIGHTS["cpu"]        * cpu_score +
        HEALTH_WEIGHTS["memory"]     * mem_score +
        HEALTH_WEIGHTS["uptime"]     * uptime_score +
        HEALTH_WEIGHTS["volatility"] * volatility_score +
        HEALTH_WEIGHTS["healing"]    * healing_score
    )
    overall = round(min(100, max(0, overall)), 1)

    # ── Letter Grade & Status Label ──────────────────────────────────────
    if overall >= 90:
        grade, status = "A", "Excellent"
    elif overall >= 75:
        grade, status = "B", "Good"
    elif overall >= 60:
        grade, status = "C", "Fair"
    elif overall >= 40:
        grade, status = "D", "Degraded"
    else:
        grade, status = "F", "Critical"

    return {
        "overall": overall,
        "grade": grade,
        "status": status,
        "components": {
            "cpu":        {"score": cpu_score,        "weight": HEALTH_WEIGHTS["cpu"],        "raw": round(cpu, 1)},
            "memory":     {"score": mem_score,         "weight": HEALTH_WEIGHTS["memory"],     "raw": round(memory, 1)},
            "uptime":     {"score": uptime_score,      "weight": HEALTH_WEIGHTS["uptime"],     "raw": uptime_seconds},
            "volatility": {"score": volatility_score,   "weight": HEALTH_WEIGHTS["volatility"], "raw": round(combined_stddev, 2)},
            "healing":    {"score": healing_score,      "weight": HEALTH_WEIGHTS["healing"],    "raw": healing_state},
        },
        "algorithm": "weighted_composite_v1",
        "weights": HEALTH_WEIGHTS,
    }


def _stddev(values: list) -> float:
    """Calculate standard deviation without importing statistics module."""
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    variance = sum((x - mean) ** 2 for x in values) / (n - 1)
    return math.sqrt(variance)
