# ─────────────────────────────────────────────────────────────────────────────
# IAM – EC2 Instance Profile  (SSM access)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ec2_ssm_role" {
  name = "${var.project_name}-ec2-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ec2.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "ec2_ssm_core" {
  role       = aws_iam_role.ec2_ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ec2_cloudwatch_agent" {
  role       = aws_iam_role.ec2_ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2_ssm_role.name
}

resource "aws_iam_role_policy" "ec2_s3_read" {
  name = "${var.project_name}-ec2-s3-read"
  role = aws_iam_role.ec2_ssm_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3FrontendRead"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.frontend_assets.arn,
          "${aws_s3_bucket.frontend_assets.arn}/*"
        ]
      }
    ]
  })
}


# ─────────────────────────────────────────────────────────────────────────────
# IAM – Lambda Execution Role  (least privilege)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_exec_role" {
  name = "${var.project_name}-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = { Project = var.project_name }
}

# ── Inline policy: CloudWatch Logs + S3 PutObject + SSM SendCommand ──────
resource "aws_iam_role_policy" "lambda_permissions" {
  name = "${var.project_name}-lambda-permissions"
  role = aws_iam_role.lambda_exec_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # 1. CloudWatch Logs – basic Lambda logging
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-remediation:*"
      },
      # 2. S3 – write audit logs to the specific bucket only
      {
        Sid      = "S3PutAuditLog"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.audit_logs.arn}/*"
      },
      # 3. SSM – send commands and get command invocation details
      {
        Sid      = "SSMCommand"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand", "ssm:GetCommandInvocation"]
        Resource = "*"
      },
      # 4. DynamoDB – write audit logs
      {
        Sid      = "DynamoDBPutAuditLog"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.audit_logs.arn
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM – API Lambda Execution Role (least privilege)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "api_lambda_role" {
  name = "${var.project_name}-api-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = { Project = var.project_name }
}

resource "aws_iam_role_policy" "api_lambda_permissions" {
  name = "${var.project_name}-api-lambda-permissions"
  role = aws_iam_role.api_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # 1. CloudWatch Logs
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-api:*"
      },
      # 2. CloudWatch Metrics (Read CPU)
      {
        Sid      = "CloudWatchMetricsRead"
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricStatistics"]
        Resource = "*"
      },
      # 3. DynamoDB (Query Audit Logs & Get State)
      {
        Sid    = "DynamoDBQuery"
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:GetItem"
        ]
        Resource = [
          aws_dynamodb_table.audit_logs.arn,
          aws_dynamodb_table.state_table.arn
        ]
      },
      # 4. EC2 (DescribeInstances for Uptime)
      {
        Sid      = "EC2Describe"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances"]
        Resource = "*"
      },
      # 5. CloudWatch Alarms (Maintenance Mode Toggle)
      {
        Sid    = "CloudWatchAlarmsToggle"
        Effect = "Allow"
        Action = [
          "cloudwatch:DisableAlarmActions",
          "cloudwatch:EnableAlarmActions",
          "cloudwatch:DescribeAlarms"
        ]
        Resource = "*"
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM – Health Manager Lambda Execution Role
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "health_manager_role" {
  name = "${var.project_name}-health-manager-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = { Project = var.project_name }
}

resource "aws_iam_role_policy" "health_manager_permissions" {
  name = "${var.project_name}-health-manager-permissions"
  role = aws_iam_role.health_manager_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # 1. CloudWatch Logs
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-health-manager:*"
      },
      # 2. DynamoDB (State and Audit logs)
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = [
          aws_dynamodb_table.audit_logs.arn,
          aws_dynamodb_table.state_table.arn
        ]
      },
      # 3. EC2 and SSM
      {
        Sid    = "EC2SSMAccess"
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceStatus",
          "ec2:RebootInstances",
          "ssm:SendCommand",
          "ssm:GetCommandInvocation"
        ]
        Resource = "*"
      },
      # 4. SNS Publish
      {
        Sid      = "SNSPublish"
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.ops_notifications.arn
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM – Predictor Lambda Execution Role (Predictive Failure Detection)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "predictor_role" {
  name = "${var.project_name}-predictor-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = { Project = var.project_name }
}

resource "aws_iam_role_policy" "predictor_permissions" {
  name = "${var.project_name}-predictor-permissions"
  role = aws_iam_role.predictor_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # 1. CloudWatch Logs
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-predictor:*"
      },
      # 2. CloudWatch Metrics – read CPU and Memory data
      {
        Sid      = "CloudWatchMetricsRead"
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricStatistics"]
        Resource = "*"
      }
    ]
  })
}
