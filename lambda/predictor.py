"""
Predictive Failure Detection Engine
────────────────────────────────────
A CUSTOM-BUILT machine-learning-inspired Lambda that runs every 5 minutes.
It pulls the last 30 minutes of CPU & Memory metrics from CloudWatch,
computes a linear regression slope, and predicts whether the metric will
breach the alarm threshold within the next 10 minutes.

If a breach is predicted, it sends a "Pre-Alert" to Discord — BEFORE the
CloudWatch alarm fires. This is a proactive self-healing capability that
AWS does NOT provide out of the box.

Algorithm:
    1. Fetch 30 min of metric data (6 data points at 5-min intervals).
    2. Normalise timestamps to [0, 1, 2, …, n] (minutes since first point).
    3. Compute least-squares linear regression:  y = slope * x + intercept
    4. Extrapolate 10 minutes into the future.
    5. If predicted value > threshold → send Pre-Alert to Discord.
"""

import json
import os
import math
import datetime
import urllib.request
import boto3

# ── Clients ───────────────────────────────────────────────────────────────
cloudwatch = boto3.client("cloudwatch")

# ── Environment variables ─────────────────────────────────────────────────
INSTANCE_ID         = os.environ.get("INSTANCE_ID")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

# ── Thresholds (must match CloudWatch alarm thresholds) ───────────────────
CPU_THRESHOLD    = 75.0   # percent
MEMORY_THRESHOLD = 60.0   # percent, matching the CloudWatch memory alarm
PREDICT_AHEAD    = 10     # minutes into the future


def handler(event, context):
    """Entry point: analyse CPU & Memory trends and send pre-alerts."""
    print(f"Predictor invoked at {datetime.datetime.now(datetime.timezone.utc).isoformat()}")

    if not INSTANCE_ID:
        print("ERROR: INSTANCE_ID not set")
        return {"status": "error", "reason": "INSTANCE_ID not set"}

    results = {}

    # ── Analyse CPU trend ─────────────────────────────────────────────────
    cpu_data = _fetch_metric(
        namespace="AWS/EC2",
        metric_name="CPUUtilization",
        dimension_name="InstanceId",
        dimension_value=INSTANCE_ID
    )
    cpu_result = _analyse_trend(cpu_data, CPU_THRESHOLD, "CPU Utilization")
    results["cpu"] = cpu_result

    if cpu_result["alert"]:
        _send_pre_alert(
            metric_name="CPU Utilization",
            current=cpu_result["current"],
            predicted=cpu_result["predicted"],
            threshold=CPU_THRESHOLD,
            slope=cpu_result["slope"],
            minutes_to_breach=cpu_result["minutes_to_breach"]
        )

    # ── Analyse Memory trend ──────────────────────────────────────────────
    mem_data = _fetch_metric(
        namespace="CWAgent",
        metric_name="mem_used_percent",
        dimension_name="InstanceId",
        dimension_value=INSTANCE_ID
    )
    mem_result = _analyse_trend(mem_data, MEMORY_THRESHOLD, "Memory Utilization")
    results["memory"] = mem_result

    if mem_result["alert"]:
        _send_pre_alert(
            metric_name="Memory Utilization",
            current=mem_result["current"],
            predicted=mem_result["predicted"],
            threshold=MEMORY_THRESHOLD,
            slope=mem_result["slope"],
            minutes_to_breach=mem_result["minutes_to_breach"]
        )

    print(f"Predictor results: {json.dumps(results)}")
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Core Algorithm: Linear Regression + Extrapolation
# ─────────────────────────────────────────────────────────────────────────────

def _analyse_trend(datapoints: list, threshold: float, label: str) -> dict:
    """Run linear regression on time-series data and predict future value.

    Returns:
        dict with keys: alert, current, predicted, slope, intercept,
                        r_squared, minutes_to_breach, data_points
    """
    if len(datapoints) < 3:
        print(f"WARN  Not enough data for {label} ({len(datapoints)} points)")
        return {
            "alert": False,
            "current": 0,
            "predicted": 0,
            "slope": 0,
            "intercept": 0,
            "r_squared": 0,
            "minutes_to_breach": None,
            "data_points": len(datapoints),
            "reason": "insufficient_data"
        }

    # Normalise timestamps to minutes since first data point
    base_ts = datapoints[0]["timestamp"]
    x_values = [(dp["timestamp"] - base_ts) / 60.0 for dp in datapoints]
    y_values = [dp["value"] for dp in datapoints]

    # ── Least-Squares Linear Regression ───────────────────────────────────
    # Formula:  slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
    #           intercept = (Σy - slope*Σx) / n
    n = len(x_values)
    sum_x  = sum(x_values)
    sum_y  = sum(y_values)
    sum_xy = sum(x * y for x, y in zip(x_values, y_values))
    sum_x2 = sum(x * x for x in x_values)

    denominator = n * sum_x2 - sum_x * sum_x
    if denominator == 0:
        slope = 0
        intercept = sum_y / n
    else:
        slope = (n * sum_xy - sum_x * sum_y) / denominator
        intercept = (sum_y - slope * sum_x) / n

    # ── R² (Coefficient of Determination) ─────────────────────────────────
    # Measures how well the linear model fits the data (0 = bad, 1 = perfect)
    mean_y = sum_y / n
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(x_values, y_values))
    ss_tot = sum((y - mean_y) ** 2 for y in y_values)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0

    # ── Extrapolate to PREDICT_AHEAD minutes from the last data point ─────
    last_x = x_values[-1]
    future_x = last_x + PREDICT_AHEAD
    predicted_value = slope * future_x + intercept

    current_value = y_values[-1]

    # ── Calculate minutes until breach (if slope is positive) ─────────────
    minutes_to_breach = None
    if slope > 0 and current_value < threshold:
        # Solve: threshold = slope * (last_x + Δt) + intercept  →  Δt = (threshold - intercept - slope*last_x) / slope
        remaining = threshold - current_value
        minutes_to_breach = round(remaining / slope, 1)

    # ── Determine if we should alert ──────────────────────────────────────
    # Alert if: predicted value > threshold AND slope is upward AND R² > 0.5
    should_alert = (
        predicted_value > threshold and
        slope > 0.5 and          # rising at least 0.5% per minute
        r_squared > 0.4 and      # trend is reasonably reliable
        current_value < threshold # not already in alarm (avoid duplicate)
    )

    return {
        "alert": should_alert,
        "current": round(current_value, 2),
        "predicted": round(predicted_value, 2),
        "slope": round(slope, 4),
        "intercept": round(intercept, 2),
        "r_squared": round(r_squared, 4),
        "minutes_to_breach": minutes_to_breach,
        "data_points": n,
        "reason": "trend_rising" if should_alert else "stable"
    }


# ─────────────────────────────────────────────────────────────────────────────
# Data Fetching
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_metric(
    namespace: str,
    metric_name: str,
    dimension_name: str,
    dimension_value: str,
    lookback_minutes: int = 30,
    period: int = 300  # 5-minute intervals
) -> list:
    """Fetch metric data from CloudWatch and return as sorted list of dicts."""
    end_time = datetime.datetime.now(datetime.timezone.utc)
    start_time = end_time - datetime.timedelta(minutes=lookback_minutes)

    try:
        response = cloudwatch.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=[{"Name": dimension_name, "Value": dimension_value}],
            StartTime=start_time,
            EndTime=end_time,
            Period=period,
            Statistics=["Average"]
        )

        datapoints = []
        for dp in response.get("Datapoints", []):
            datapoints.append({
                "timestamp": dp["Timestamp"].timestamp(),
                "value": dp["Average"]
            })

        # Sort by timestamp ascending
        datapoints.sort(key=lambda x: x["timestamp"])
        return datapoints

    except Exception as exc:
        print(f"ERROR  Failed to fetch {metric_name}: {exc}")
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Discord Pre-Alert
# ─────────────────────────────────────────────────────────────────────────────

def _send_pre_alert(
    metric_name: str,
    current: float,
    predicted: float,
    threshold: float,
    slope: float,
    minutes_to_breach: float | None
) -> None:
    """Send a predictive pre-alert to Discord."""
    if not DISCORD_WEBHOOK_URL:
        return

    breach_eta = f"~{minutes_to_breach} minutes" if minutes_to_breach else "imminent"

    message = (
        f"⚠️ **PREDICTIVE PRE-ALERT** ⚠️\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🔮 **Metric:** {metric_name}\n"
        f"📊 **Current Value:** `{current}%`\n"
        f"📈 **Predicted (in 10 min):** `{predicted}%`\n"
        f"🚨 **Alarm Threshold:** `{threshold}%`\n"
        f"📐 **Trend Slope:** `{slope}% / min`\n"
        f"⏱️ **Estimated Breach In:** `{breach_eta}`\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🤖 *Detected by Linear Regression Predictive Engine*\n"
        f"💡 *This alert was generated BEFORE the CloudWatch alarm fired.*"
    )

    req = urllib.request.Request(DISCORD_WEBHOOK_URL, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "SelfHealingPredictor/1.0")
    data = json.dumps({"content": message}).encode("utf-8")

    try:
        urllib.request.urlopen(req, data=data, timeout=5)
        print(f"Pre-Alert sent for {metric_name}")
    except Exception as exc:
        print(f"WARN  Failed to send Pre-Alert: {exc}")
