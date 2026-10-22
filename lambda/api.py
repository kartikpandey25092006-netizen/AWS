import os
import json
import boto3
import datetime
import math
from functools import lru_cache
from decimal import Decimal
from boto3.dynamodb.conditions import Key

# ── Clients (initialised outside handler for connection reuse) ────────────
cloudwatch = boto3.client("cloudwatch")
ec2 = boto3.client("ec2")
dynamodb = boto3.resource("dynamodb")

INSTANCE_ID = os.environ.get("INSTANCE_ID")
DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE")
STATE_TABLE = os.environ.get("STATE_TABLE")
LAMBDA_WEB_FUNCTION_NAME = os.environ.get("LAMBDA_WEB_FUNCTION_NAME", "fieldwork-store-api-web")
LAMBDA_WEB_ENDPOINT_NAME = os.environ.get("LAMBDA_WEB_ENDPOINT_NAME", "storefront")
LAMBDA_WEB_EXECUTION_REGION = os.environ.get("AWS_REGION", "us-east-1")


def json_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body),
    }


def has_admin_group(groups):
    if isinstance(groups, str):
        if groups == "store-admin":
            return True
        try:
            groups = json.loads(groups)
        except (TypeError, json.JSONDecodeError):
            # HTTP API integrations can flatten group arrays to [group1 group2].
            # Cognito group names cannot contain whitespace. Comma-separated
            # strings are ambiguous because commas are valid in group names.
            if not (groups.startswith("[") and groups.endswith("]")):
                return False
            groups = groups[1:-1].split()

    # Do not split arbitrary strings on commas or use substring matching: names may
    # contain punctuation, and lookalike group names must not grant access.
    return (
        isinstance(groups, list)
        and all(isinstance(group, str) for group in groups)
        and "store-admin" in groups
    )


def admin_authorization_error(event):
    # API Gateway's JWT authorizer validates signature, issuer, audience and
    # expiry. Browser headers, body fields and decoded JWTs are not trusted.
    claims = event
    for key in ("requestContext", "authorizer", "jwt", "claims"):
        if not isinstance(claims, dict):
            return json_response(401, {"error": "Authentication is required."})
        claims = claims.get(key)

    if (
        not isinstance(claims, dict)
        or not isinstance(claims.get("sub"), str)
        or not claims["sub"].strip()
    ):
        return json_response(401, {"error": "Authentication is required."})

    if not has_admin_group(claims.get("cognito:groups")):
        return json_response(403, {"error": "Administrator access is required."})

    return None


def handler(event, context):
    raw_path = event.get('rawPath', '')
    request_context = event.get("requestContext")
    http_context = request_context.get("http") if isinstance(request_context, dict) else None
    method = http_context.get("method", "GET") if isinstance(http_context, dict) else "GET"
    print(f"Received API request: {method} {raw_path}")

    try:
        route_methods = {
            "/api/status": "GET",
            "/api/maintenance": "POST",
            "/api/session": "GET",
        }
        if raw_path not in route_methods:
            return json_response(404, {"error": "Not found."})
        if method != route_methods[raw_path]:
            return json_response(405, {"error": "Method not allowed."})

        authorization_error = admin_authorization_error(event)
        if authorization_error:
            return authorization_error

        if raw_path == "/api/session":
            return json_response(200, {"role": "store-admin"})

        if raw_path == "/api/maintenance":
            try:
                body = json.loads(event.get("body") or "")
            except (TypeError, json.JSONDecodeError):
                return {
                    "statusCode": 400,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps({"error": "Request body must be valid JSON."}),
                }

            if not isinstance(body, dict) or not isinstance(body.get("maintenance"), bool):
                return {
                    "statusCode": 400,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps({"error": "The 'maintenance' field must be a boolean."}),
                }

            maintenance_mode = body["maintenance"]

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

        # GET /api/status
        else:
            time_range = event.get("queryStringParameters", {}).get("time_range", "40m") if event.get("queryStringParameters") else "40m"

            uptime_seconds = get_uptime(INSTANCE_ID)
            cpu_history, current_cpu, is_simulating = get_cpu_metrics(INSTANCE_ID, time_range)
            memory_history, current_memory, is_memory_simulating = get_memory_metrics(INSTANCE_ID, time_range)
            audit_logs = get_audit_logs(INSTANCE_ID)
            healing_state = get_healing_state()
            store_metrics = get_store_metrics(INSTANCE_ID)
            lambda_web_metrics = get_lambda_web_metrics()

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
                "store_metrics": store_metrics,
                "lambda_web_metrics": lambda_web_metrics,
                "health_score": compute_health_score(
                    cpu=current_cpu,
                    memory=current_memory,
                    uptime_seconds=uptime_seconds,
                    cpu_history=cpu_history,
                    memory_history=memory_history,
                    healing_state=healing_state
                ) if current_memory is not None else None
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
            "body": json.dumps({"error": "The request could not be completed."})
        }


def get_store_metrics(instance_id):
    # Cache completed one-minute periods so the 10-second dashboard poll does not
    # repeatedly query unchanged application data in a warm Lambda environment.
    minute = int(datetime.datetime.now(datetime.timezone.utc).timestamp() // 60)
    return _get_store_metrics(instance_id, minute)


@lru_cache(maxsize=4)
def _get_store_metrics(instance_id, minute):
    empty = {"status": "no_data", "window_minutes": 5, "observed_seconds": 0,
             "request_count": None, "requests_per_minute": None,
             "client_errors": None, "server_errors": None,
             "server_error_percent": None, "average_response_ms": None,
             "last_sample": None, "instance_id": instance_id}
    if not instance_id:
        return empty
    end = datetime.datetime.fromtimestamp(minute * 60, datetime.timezone.utc)
    start = end - datetime.timedelta(minutes=5)
    dimensions = [{"Name": "Service", "Value": "store-api"},
                  {"Name": "InstanceId", "Value": instance_id}]
    points = {}
    try:
        for name in ("RequestCount", "ClientErrorCount", "ServerErrorCount",
                     "CollectionSeconds", "ResponseDuration"):
            response = cloudwatch.get_metric_statistics(
                Namespace="Fieldwork/StoreApi", MetricName=name, Dimensions=dimensions,
                StartTime=start, EndTime=end, Period=60,
                Statistics=["Sum", "SampleCount"],
            )
            points[name] = {p["Timestamp"]: p for p in response.get("Datapoints", [])
                            if start <= p["Timestamp"] < end}
    except Exception as error:
        print(f"Store API metrics unavailable: {type(error).__name__}")
        return {**empty, "status": "error"}

    # Only count periods with collection evidence AND all three counters. A
    # missing counter is never treated as zero, including during ingestion lag.
    timestamps = set.intersection(*(set(points[name]) for name in (
        "RequestCount", "ClientErrorCount", "ServerErrorCount", "CollectionSeconds")))
    timestamps = {t for t in timestamps if all(
        isinstance(points[name][t].get("Sum"), (int, float))
        and math.isfinite(points[name][t]["Sum"]) and points[name][t]["Sum"] >= 0
        for name in ("RequestCount", "ClientErrorCount", "ServerErrorCount", "CollectionSeconds"))
        and 0 < points["CollectionSeconds"][t]["Sum"] <= 90}
    if not timestamps:
        return empty
    total = lambda name: sum(points[name][t]["Sum"] for t in timestamps)
    requests = total("RequestCount")
    collected = total("CollectionSeconds")
    latency_samples = [points["ResponseDuration"][t] for t in timestamps
                       if t in points["ResponseDuration"]]
    duration_count = sum(p.get("SampleCount", 0) for p in latency_samples)
    duration_sum = sum(p.get("Sum", 0) for p in latency_samples)
    latest = max(timestamps)
    age_seconds = (end - latest).total_seconds()
    return {
        **empty,
        "status": "stale" if age_seconds > 180 else ("available" if len(timestamps) == 5 and collected >= 270 else "partial"),
        "observed_seconds": round(collected, 1),
        "request_count": requests,
        "requests_per_minute": round(requests * 60 / collected, 2),
        "client_errors": total("ClientErrorCount"),
        "server_errors": total("ServerErrorCount"),
        "server_error_percent": round(total("ServerErrorCount") * 100 / requests, 2) if requests else None,
        "average_response_ms": round(duration_sum / duration_count, 2)
            if duration_count == requests and duration_count > 0
            and math.isfinite(duration_sum) and duration_sum >= 0 else None,
        "last_sample": latest.isoformat(),
    }


def get_lambda_web_metrics():
    # Native Lambda Web request metrics are aggregated in completed one-minute
    # periods. Cache by minute so the dashboard's 10-second poll does not repeat
    # the same CloudWatch reads.
    minute = int(datetime.datetime.now(datetime.timezone.utc).timestamp() // 60)
    return _get_lambda_web_metrics(LAMBDA_WEB_FUNCTION_NAME, LAMBDA_WEB_ENDPOINT_NAME, minute)


@lru_cache(maxsize=4)
def _get_lambda_web_metrics(function_name, endpoint_name, minute):
    end = datetime.datetime.fromtimestamp(minute * 60, datetime.timezone.utc)
    start = end - datetime.timedelta(minutes=5)
    dimensions = [
        {"Name": "FunctionName", "Value": function_name},
        {"Name": "EndpointName", "Value": endpoint_name},
    ]
    empty = {
        "status": "no_data", "window_minutes": 5, "observed_seconds": 300,
        "request_count": 0, "requests_per_minute": 0,
        "client_errors": 0, "server_errors": 0,
        "environment_cpu_ms": None, "peak_memory_mb": None,
        "peak_concurrent_requests": None, "active_environments": None,
        "endpoint_request_throttles": 0, "environment_throttles": 0,
        "last_sample": None, "function_name": function_name,
        "endpoint_name": endpoint_name,
    }
    endpoint_metrics = {
        "ExecutedRequests": ("AWS/Lambda/Web", dimensions, "Sum"),
        "HTTPResponseStatusClass4XX": ("AWS/Lambda/Web", dimensions, "Sum"),
        "HTTPResponseStatusClass5XX": ("AWS/Lambda/Web", dimensions, "Sum"),
        "EnvironmentCPUTime": ("AWS/Lambda/Web", [{"Name": "FunctionName", "Value": function_name}], "Sum"),
        "EnvironmentMaxMemoryUsage": ("AWS/Lambda/Web", [{"Name": "FunctionName", "Value": function_name}], "Maximum"),
        "EnvironmentConcurrentRequests": ("AWS/Lambda/Web", [{"Name": "FunctionName", "Value": function_name}], "Maximum"),
        "EndpointActiveEnvironments": (
            "AWS/Lambda/Web/Usage",
            dimensions + [{"Name": "ExecutionRegion", "Value": LAMBDA_WEB_EXECUTION_REGION}],
            "Maximum",
        ),
        "EndpointRequestThrottles": (
            "AWS/Lambda/Web/Usage",
            dimensions + [{"Name": "ExecutionRegion", "Value": LAMBDA_WEB_EXECUTION_REGION}],
            "Sum",
        ),
        "EndpointActiveEnvironmentThrottles": (
            "AWS/Lambda/Web/Usage",
            dimensions + [{"Name": "ExecutionRegion", "Value": LAMBDA_WEB_EXECUTION_REGION}],
            "Sum",
        ),
    }
    points = {}
    try:
        for metric_name, (namespace, metric_dimensions, statistic) in endpoint_metrics.items():
            response = cloudwatch.get_metric_statistics(
                Namespace=namespace, MetricName=metric_name,
                Dimensions=metric_dimensions, StartTime=start, EndTime=end, Period=60,
                Statistics=[statistic],
            )
            points[metric_name] = [
                point for point in response.get("Datapoints", [])
                if start <= point["Timestamp"] < end
                and isinstance(point.get(statistic), (int, float))
                and math.isfinite(point[statistic]) and point[statistic] >= 0
            ]
    except Exception as error:
        print(f"Lambda Web metrics unavailable: {type(error).__name__}")
        return {**empty, "status": "error", "request_count": None,
                "requests_per_minute": None, "client_errors": None,
                "server_errors": None}

    sum_metric = lambda name: sum(point["Sum"] for point in points[name])
    max_metric = lambda name: max((point["Maximum"] for point in points[name]), default=None)
    requests = sum_metric("ExecutedRequests")
    relevant_metrics = (
        "ExecutedRequests", "HTTPResponseStatusClass4XX", "HTTPResponseStatusClass5XX",
        "EndpointRequestThrottles", "EndpointActiveEnvironmentThrottles",
    )
    datapoints = [point for metric in points.values() for point in metric]
    has_request_or_limit_data = any(points[name] for name in relevant_metrics)
    latest = max((point["Timestamp"] for point in datapoints), default=None)
    cpu_points = points["EnvironmentCPUTime"]
    cpu_time = sum_metric("EnvironmentCPUTime") if cpu_points else None
    return {
        **empty,
        "status": "available" if has_request_or_limit_data or datapoints else "no_data",
        "request_count": requests,
        "requests_per_minute": round(requests / 5, 2),
        "client_errors": sum_metric("HTTPResponseStatusClass4XX"),
        "server_errors": sum_metric("HTTPResponseStatusClass5XX"),
        "environment_cpu_ms": cpu_time,
        "peak_memory_mb": max_metric("EnvironmentMaxMemoryUsage"),
        "peak_concurrent_requests": max_metric("EnvironmentConcurrentRequests"),
        "active_environments": max_metric("EndpointActiveEnvironments"),
        "endpoint_request_throttles": sum_metric("EndpointRequestThrottles"),
        "environment_throttles": sum_metric("EndpointActiveEnvironmentThrottles"),
        "last_sample": latest.isoformat() if latest else None,
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

@lru_cache(maxsize=8)
def get_instance_private_dns(instance_id):
    response = ec2.describe_instances(InstanceIds=[instance_id])
    return response["Reservations"][0]["Instances"][0]["PrivateDnsName"]


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
        
        # The CloudWatch Agent on this instance publishes memory with its
        # private DNS name in the host dimension, not InstanceId.
        instance_host = get_instance_private_dns(instance_id)
        response = cloudwatch.get_metric_statistics(
            Namespace="CWAgent",
            MetricName="mem_used_percent",
            Dimensions=[{"Name": "host", "Value": instance_host}],
            StartTime=start_time,
            EndTime=end_time,
            Period=period,
            Statistics=["Average"]
        )
        
        datapoints = response.get("Datapoints", [])
        if not datapoints:
            return [], None, False
        # Sort by timestamp ascending
        datapoints.sort(key=lambda x: x["Timestamp"])
        
        # Format for frontend
        history = []
        for dp in datapoints:
            history.append({
                "time": dp["Timestamp"].isoformat(),
                "memory": round(dp["Average"], 1)
            })
            
        # Return only observed samples; zero is a real metric value.
        history = history[-num_points:]
        
        current_memory = history[-1]["memory"] if history else 0
        is_memory_simulating = current_memory > 60.0
        
        return history, current_memory, is_memory_simulating
    except Exception as e:
        print(f"Error fetching Memory: {e}")
        return [], None, False

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
