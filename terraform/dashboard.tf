# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Dashboard (Feature 4)
# FREE TIER: 3 custom dashboards included at no charge.
# Provides a single-pane-of-glass view of the entire self-healing system.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_dashboard" "self_healing" {
  dashboard_name = "${var.project_name}-dashboard"

  dashboard_body = jsonencode({
    widgets = [

      # ── Row 1: Header ────────────────────────────────────────────────
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = <<-MD
            # 🛡️ Self-Healing Infrastructure Dashboard
            **Instance:** `${aws_instance.web_server.id}` | **Region:** `${data.aws_region.current.name}` | **Bucket:** `${aws_s3_bucket.audit_logs.id}`
          MD
        }
      },

      # ── Row 2: EC2 CPU Utilization ───────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 2
        width  = 8
        height = 6
        properties = {
          metrics = [
            [
              "AWS/EC2", "CPUUtilization",
              "InstanceId", aws_instance.web_server.id,
              { stat = "Average", period = 300, label = "CPU %" }
            ]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "📊 EC2 CPU Utilization"
          yAxis = {
            left = { min = 0, max = 100 }
          }
          annotations = {
            horizontal = [
              {
                label = "Alarm Threshold"
                value = var.cpu_threshold
                color = "#d13212"
              }
            ]
          }
        }
      },

      # ── Row 2: EC2 Memory Utilization ────────────────────────────────
      {
        type   = "metric"
        x      = 8
        y      = 2
        width  = 8
        height = 6
        properties = {
          metrics = [
            [
              "CWAgent", "mem_used_percent",
              "InstanceId", aws_instance.web_server.id,
              { stat = "Average", period = 60, label = "Memory %", color = "#9467bd" }
            ]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "🧠 EC2 Memory Utilization"
          yAxis = {
            left = { min = 0, max = 100 }
          }
        }
      },

      # ── Row 2: EC2 Status Checks ────────────────────────────────────
      {
        type   = "metric"
        x      = 16
        y      = 2
        width  = 8
        height = 6
        properties = {
          metrics = [
            [
              "AWS/EC2", "StatusCheckFailed_System",
              "InstanceId", aws_instance.web_server.id,
              { stat = "Maximum", period = 60, label = "System Check", color = "#d13212" }
            ],
            [
              "AWS/EC2", "StatusCheckFailed_Instance",
              "InstanceId", aws_instance.web_server.id,
              { stat = "Maximum", period = 60, label = "Instance Check", color = "#ff9900" }
            ],
            [
              "AWS/EC2", "StatusCheckFailed",
              "InstanceId", aws_instance.web_server.id,
              { stat = "Maximum", period = 60, label = "Any Check Failed", color = "#1f77b4" }
            ]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "🏥 EC2 Health Status Checks"
          yAxis = {
            left = { min = 0, max = 2 }
          }
        }
      },

      # ── Row 3: Lambda Invocations ───────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 8
        width  = 12
        height = 6
        properties = {
          metrics = [
            [
              "AWS/Lambda", "Invocations",
              "FunctionName", aws_lambda_function.remediation.function_name,
              { stat = "Sum", period = 300, label = "Invocations", color = "#2ca02c" }
            ],
            [
              "AWS/Lambda", "Errors",
              "FunctionName", aws_lambda_function.remediation.function_name,
              { stat = "Sum", period = 300, label = "Errors", color = "#d13212" }
            ],
            [
              "AWS/Lambda", "Throttles",
              "FunctionName", aws_lambda_function.remediation.function_name,
              { stat = "Sum", period = 300, label = "Throttles", color = "#ff9900" }
            ]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "⚡ Lambda Remediation Activity"
        }
      },

      # ── Row 3: Lambda Duration ──────────────────────────────────────
      {
        type   = "metric"
        x      = 12
        y      = 8
        width  = 12
        height = 6
        properties = {
          metrics = [
            [
              "AWS/Lambda", "Duration",
              "FunctionName", aws_lambda_function.remediation.function_name,
              { stat = "Average", period = 300, label = "Avg Duration (ms)", color = "#9467bd" }
            ],
            [
              "AWS/Lambda", "Duration",
              "FunctionName", aws_lambda_function.remediation.function_name,
              { stat = "Maximum", period = 300, label = "Max Duration (ms)", color = "#d62728" }
            ]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "⏱️ Lambda Execution Duration"
        }
      },

      # ── Row 4: Alarm States ─────────────────────────────────────────
      {
        type   = "alarm"
        x      = 0
        y      = 14
        width  = 24
        height = 3
        properties = {
          title = "🚨 Alarm States"
          alarms = [
            aws_cloudwatch_metric_alarm.high_cpu.arn,
            aws_cloudwatch_metric_alarm.auto_recovery.arn,
            aws_cloudwatch_metric_alarm.instance_health.arn,
            aws_cloudwatch_metric_alarm.lambda_errors.arn
          ]
        }
      }
    ]
  })
}
