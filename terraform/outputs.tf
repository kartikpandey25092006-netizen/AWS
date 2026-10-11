# ─────────────────────────────────────────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────────────────────────────────────────

# ── EC2 ───────────────────────────────────────────────────────────────────
output "ec2_instance_id" {
  description = "ID of the web server EC2 instance"
  value       = aws_instance.web_server.id
}

output "ec2_public_ip" {
  description = "Public IP of the EC2 web origin; prefer the CloudFront HTTPS output for browser access"
  value       = aws_instance.web_server.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS of the web server"
  value       = aws_instance.web_server.public_dns
}

# ── S3 ────────────────────────────────────────────────────────────────────
output "s3_audit_bucket" {
  description = "Name of the S3 bucket storing audit logs"
  value       = aws_s3_bucket.audit_logs.id
}

output "s3_frontend_bucket" {
  description = "Name of the S3 bucket storing frontend assets"
  value       = aws_s3_bucket.frontend_assets.id
}

# ── Lambda ────────────────────────────────────────────────────────────────
output "lambda_remediation_function" {
  description = "The name of the Lambda function that restarts Nginx."
  value       = aws_lambda_function.remediation.function_name
}

output "api_gateway_url" {
  description = "The URL of the API Gateway HTTP API for the frontend"
  value       = aws_apigatewayv2_api.frontend_api.api_endpoint
}

# ── SNS ───────────────────────────────────────────────────────────────────
output "sns_remediation_topic_arn" {
  description = "ARN of the SNS topic for remediation actions (CPU alarm → Lambda)"
  value       = aws_sns_topic.cpu_alarm_topic.arn
}

output "sns_ops_topic_arn" {
  description = "ARN of the SNS topic for operational alerts (email only)"
  value       = aws_sns_topic.ops_notifications.arn
}

# ── CloudWatch Alarms ─────────────────────────────────────────────────────
output "alarm_high_cpu" {
  description = "Name of the CPU utilisation alarm"
  value       = aws_cloudwatch_metric_alarm.high_cpu.alarm_name
}

output "alarm_auto_recovery" {
  description = "Name of the EC2 auto recovery alarm (hardware)"
  value       = aws_cloudwatch_metric_alarm.auto_recovery.alarm_name
}

output "alarm_instance_health" {
  description = "Name of the instance health alarm (OS-level)"
  value       = aws_cloudwatch_metric_alarm.instance_health.alarm_name
}

output "alarm_lambda_errors" {
  description = "Name of the Lambda errors alarm"
  value       = aws_cloudwatch_metric_alarm.lambda_errors.alarm_name
}

# ── Dashboard ─────────────────────────────────────────────────────────────
output "dashboard_url" {
  description = "URL to the CloudWatch dashboard"
  value       = "https://${data.aws_region.current.name}.console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.name}#dashboards:name=${aws_cloudwatch_dashboard.self_healing.dashboard_name}"
}

# ── Test Commands ─────────────────────────────────────────────────────────
output "test_cpu_spike_command" {
  description = "SSM command to trigger a CPU spike for testing"
  value       = "aws ssm send-command --instance-ids ${aws_instance.web_server.id} --document-name AWS-RunShellScript --parameters 'commands=[\"stress-ng --cpu 2 --cpu-load 95 --timeout 600s &\"]' --comment 'Test CPU spike'"
}

output "test_stop_stress_command" {
  description = "SSM command to stop the stress test"
  value       = "aws ssm send-command --instance-ids ${aws_instance.web_server.id} --document-name AWS-RunShellScript --parameters 'commands=[\"pkill -f stress-ng\"]' --comment 'Stop stress test'"
}

# ── Cognito Authentication ───────────────────────────────────────────────
output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.pool.id
}

output "cognito_user_pool_client_id" {
  description = "Cognito User Pool App Client ID"
  value       = aws_cognito_user_pool_client.client.id
}

output "cognito_domain" {
  description = "Cognito Hosted UI Domain prefix URL"
  value       = "https://${aws_cognito_user_pool_domain.domain.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "cognito_authority" {
  description = "OIDC Issuer / Authority URL"
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.pool.id}"
}

output "admin_user_creation_command" {
  description = "AWS CLI command to create the initial dashboard operator user"
  value       = "aws cognito-idp admin-create-user --user-pool-id ${aws_cognito_user_pool.pool.id} --username admin@cloudops.internal --user-attributes Name=email,Value=admin@cloudops.internal Name=email_verified,Value=true"
}

output "cloudfront_domain" {
  description = "CloudFront HTTPS Distribution URL for Frontend"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID used for frontend cache invalidation"
  value       = aws_cloudfront_distribution.frontend.id
}


