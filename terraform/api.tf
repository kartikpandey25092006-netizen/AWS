# ─────────────────────────────────────────────────────────────────────────────
# API Gateway & Lambda Handler for Frontend
# ─────────────────────────────────────────────────────────────────────────────

# ── Package the Python source into a zip ──────────────────────────────────
data "archive_file" "api_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/api.py"
  output_path = "${path.module}/.build/api.zip"
}

# ── Lambda function ───────────────────────────────────────────────────────
resource "aws_lambda_function" "api_handler" {
  function_name = "${var.project_name}-api"
  description   = "Serves real-time AWS metrics and logs to the frontend"
  role          = aws_iam_role.api_lambda_role.arn
  handler       = "api.handler"
  runtime       = "python3.12"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.api_zip.output_path
  source_code_hash = data.archive_file.api_zip.output_base64sha256

  environment {
    variables = {
      INSTANCE_ID    = aws_instance.web_server.id
      DYNAMODB_TABLE = aws_dynamodb_table.audit_logs.name
      STATE_TABLE    = aws_dynamodb_table.state_table.name
    }
  }

  tags = { Project = var.project_name }

  depends_on = [
    aws_iam_role_policy.api_lambda_permissions,
  ]
}

# ── CloudWatch Log Group for API Lambda ───────────────────────────────────
resource "aws_cloudwatch_log_group" "api_lambda_logs" {
  name              = "/aws/lambda/${aws_lambda_function.api_handler.function_name}"
  retention_in_days = 7

  tags = { Project = var.project_name }
}

# ── API Gateway (HTTP API) ────────────────────────────────────────────────
resource "aws_apigatewayv2_api" "frontend_api" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [
      "https://${aws_cloudfront_distribution.frontend.domain_name}",
      "http://localhost:3000"
    ]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["Authorization", "Content-Type"]
    max_age       = 300
  }

  tags = { Project = var.project_name }
}

resource "aws_apigatewayv2_stage" "api_stage" {
  api_id      = aws_apigatewayv2_api.frontend_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.frontend_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt-authorizer"

  jwt_configuration {
    issuer   = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.pool.id}"
    audience = [aws_cognito_user_pool_client.client.id]
  }
}

resource "aws_apigatewayv2_integration" "lambda_integration" {
  api_id           = aws_apigatewayv2_api.frontend_api.id
  integration_type = "AWS_PROXY"

  integration_method = "POST"
  integration_uri    = aws_lambda_function.api_handler.invoke_arn
}

resource "aws_apigatewayv2_route" "status_route" {
  api_id             = aws_apigatewayv2_api.frontend_api.id
  route_key          = "GET /api/status"
  target             = "integrations/${aws_apigatewayv2_integration.lambda_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "maintenance_route" {
  api_id             = aws_apigatewayv2_api.frontend_api.id
  route_key          = "POST /api/maintenance"
  target             = "integrations/${aws_apigatewayv2_integration.lambda_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "allow_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.frontend_api.execution_arn}/*/*"
}

