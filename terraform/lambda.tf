# ─────────────────────────────────────────────────────────────────────────────
# Lambda Function – Self-Healing Remediation
# ─────────────────────────────────────────────────────────────────────────────

# ── Package the Python source into a zip ──────────────────────────────────
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/main.py"
  output_path = "${path.module}/.build/lambda.zip"
}

# ── Lambda function ───────────────────────────────────────────────────────
resource "aws_lambda_function" "remediation" {
  function_name = "${var.project_name}-remediation"
  description   = "Restarts nginx on EC2 via SSM when CloudWatch alarm fires"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "main.handler"
  runtime       = "python3.12"
  timeout       = 30
  memory_size   = 128 # minimum – Free Tier gives 1M requests & 400k GB-s/month

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      AUDIT_BUCKET        = aws_s3_bucket.audit_logs.id
      DYNAMODB_TABLE      = aws_dynamodb_table.audit_logs.name
      DISCORD_WEBHOOK_URL = var.discord_webhook_url
    }
  }

  tags = { Project = var.project_name }

  depends_on = [
    aws_iam_role_policy.lambda_permissions,
  ]
}

# ── CloudWatch Log Group for Lambda (explicit so we can set retention) ────
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${aws_lambda_function.remediation.function_name}"
  retention_in_days = 14

  tags = { Project = var.project_name }
}

# ── SNS subscription: Lambda subscribes to the alarm topic ────────────────
resource "aws_sns_topic_subscription" "lambda_sub" {
  topic_arn = aws_sns_topic.cpu_alarm_topic.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.remediation.arn
}

# ── Permission: allow SNS to invoke the Lambda function ───────────────────
resource "aws_lambda_permission" "allow_sns" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.remediation.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.cpu_alarm_topic.arn
}

# ─────────────────────────────────────────────────────────────────────────────
# Lambda Function – Health Manager
# ─────────────────────────────────────────────────────────────────────────────

data "archive_file" "health_manager_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/health_manager.py"
  output_path = "${path.module}/.build/health_manager.zip"
}

resource "aws_lambda_function" "health_manager" {
  function_name = "${var.project_name}-health-manager"
  description   = "Centralized state manager for self-healing workflow"
  role          = aws_iam_role.health_manager_role.arn
  handler       = "health_manager.handler"
  runtime       = "python3.12"
  timeout       = 30
  memory_size   = 128

  filename         = data.archive_file.health_manager_zip.output_path
  source_code_hash = data.archive_file.health_manager_zip.output_base64sha256

  environment {
    variables = {
      STATE_TABLE                 = aws_dynamodb_table.state_table.name
      AUDIT_TABLE                 = aws_dynamodb_table.audit_logs.name
      OPS_TOPIC_ARN               = aws_sns_topic.ops_notifications.arn
      INSTANCE_ID                 = aws_instance.web_server.id
      APP_RECOVERY_ENABLED        = "true"
      STORE_API_RECOVERY_DOCUMENT = aws_ssm_document.store_api_recovery.name
    }
  }

  tags = { Project = var.project_name }
}

resource "aws_cloudwatch_log_group" "health_manager_logs" {
  name              = "/aws/lambda/${aws_lambda_function.health_manager.function_name}"
  retention_in_days = 14
  tags              = { Project = var.project_name }
}

# ─────────────────────────────────────────────────────────────────────────────
# Lambda Function – Predictive Failure Detection (Linear Regression Engine)
# ─────────────────────────────────────────────────────────────────────────────

data "archive_file" "predictor_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/predictor.py"
  output_path = "${path.module}/.build/predictor.zip"
}

resource "aws_lambda_function" "predictor" {
  function_name = "${var.project_name}-predictor"
  description   = "Predictive failure detection using linear regression on CloudWatch metrics"
  role          = aws_iam_role.predictor_role.arn
  handler       = "predictor.handler"
  runtime       = "python3.12"
  timeout       = 30
  memory_size   = 128

  filename         = data.archive_file.predictor_zip.output_path
  source_code_hash = data.archive_file.predictor_zip.output_base64sha256

  environment {
    variables = {
      INSTANCE_ID         = aws_instance.web_server.id
      DISCORD_WEBHOOK_URL = var.discord_webhook_url
    }
  }

  tags = { Project = var.project_name }
}

resource "aws_cloudwatch_log_group" "predictor_logs" {
  name              = "/aws/lambda/${aws_lambda_function.predictor.function_name}"
  retention_in_days = 14
  tags              = { Project = var.project_name }
}
