# ─────────────────────────────────────────────────────────────────────────────
# SNS Topic – Remediation (triggers Lambda for self-healing actions)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "cpu_alarm_topic" {
  name = "${var.project_name}-cpu-alarm-topic"

  tags = { Project = var.project_name }
}

# Allow CloudWatch to publish to this topic
resource "aws_sns_topic_policy" "allow_cloudwatch" {
  arn = aws_sns_topic.cpu_alarm_topic.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudWatchPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.cpu_alarm_topic.arn
      }
    ]
  })
}

# ── (Feature 1) Email subscription on remediation topic ───────────────────
# Sends an email every time the CPU alarm fires AND Lambda remediates.
resource "aws_sns_topic_subscription" "remediation_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.cpu_alarm_topic.arn
  protocol  = "email"
  endpoint  = var.alert_email
}


# ─────────────────────────────────────────────────────────────────────────────
# SNS Topic – Ops Notifications (email-only, NO Lambda subscriber)
# Used for operational alerts like Lambda errors and instance health.
# Separate from the remediation topic to prevent feedback loops.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "ops_notifications" {
  name = "${var.project_name}-ops-notifications"

  tags = { Project = var.project_name }
}

resource "aws_sns_topic_policy" "ops_allow_cloudwatch" {
  arn = aws_sns_topic.ops_notifications.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudWatchPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.ops_notifications.arn
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "ops_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.ops_notifications.arn
  protocol  = "email"
  endpoint  = var.alert_email
}


# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Alarm 1 – CPUUtilization (Standard, FREE TIER)
# Triggers Lambda via SNS to restart nginx.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "${var.project_name}-high-cpu"
  alarm_description   = "Triggers when EC2 CPU utilisation exceeds ${var.cpu_threshold}% for ${var.alarm_period_seconds}s"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = var.alarm_period_seconds
  statistic           = "Average"
  threshold           = var.cpu_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.web_server.id
  }

  alarm_actions = [aws_sns_topic.cpu_alarm_topic.arn]
  ok_actions    = [] # no action on recovery

  tags = { Project = var.project_name }
}


# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Alarm 2 – EC2 Auto Recovery (FREE)
# Hardware-level: migrates instance to healthy hardware on system check fail.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "auto_recovery" {
  alarm_name          = "${var.project_name}-auto-recovery"
  alarm_description   = "Recovers EC2 instance when system status check fails for 2 consecutive minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed_System"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.web_server.id
  }

  alarm_actions = [
    aws_sns_topic.ops_notifications.arn
  ]

  ok_actions = []

  tags = { Project = var.project_name }
}


# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Alarm 3 – Lambda Errors (Feature 3)
# Alerts if the self-healing Lambda itself is failing.
# Publishes to ops_notifications (NOT the remediation topic) to avoid loops.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.project_name}-lambda-errors"
  alarm_description   = "CRITICAL: The self-healing Lambda function is failing. Manual intervention required."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.remediation.function_name
  }

  # Goes to ops topic (email only) — NOT the remediation topic
  alarm_actions = [aws_sns_topic.ops_notifications.arn]
  ok_actions    = [aws_sns_topic.ops_notifications.arn]

  tags = { Project = var.project_name }
}


# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Alarm 4 – StatusCheckFailed_Instance (Feature 6)
# OS/software-level: reboots the instance on instance status check failure.
# This catches OS-level hangs, memory exhaustion, and kernel panics.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "instance_health" {
  alarm_name          = "${var.project_name}-instance-health"
  alarm_description   = "Reboots EC2 instance when instance status check fails for 3 consecutive minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "StatusCheckFailed_Instance"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.web_server.id
  }

  # Notify ops (Recovery handled by Health Manager Lambda)
  alarm_actions = [
    aws_sns_topic.ops_notifications.arn
  ]

  ok_actions = []

  tags = { Project = var.project_name }
}

# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Alarm 5 – Memory Utilization (Feature: Memory Monitoring)
# Triggers Lambda via SNS to remediate if RAM usage is > 60%.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "high_memory" {
  alarm_name          = "${var.project_name}-high-memory"
  alarm_description   = "Triggers when EC2 Memory utilisation exceeds 60% for 60 seconds"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "mem_used_percent"
  namespace           = "CWAgent"
  period              = 60
  statistic           = "Average"
  threshold           = 60
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.web_server.id
  }

  # Goes to the same remediation topic that restarts nginx
  alarm_actions = [aws_sns_topic.cpu_alarm_topic.arn]
  ok_actions    = []

  tags = { Project = var.project_name }
}

