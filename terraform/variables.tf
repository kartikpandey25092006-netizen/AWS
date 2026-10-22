# ─────────────────────────────────────────────────────────────────────────────
# Input Variables
# ─────────────────────────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix applied to all resource names for easy identification."
  type        = string
  default     = "self-healing"
}

variable "cloudops_shared_cognito_user_pool_id" {
  description = "Existing Storefront Cognito pool to trust for administrator SSO. Supply together with the shared client ID; null retains the legacy operator identity."
  type        = string
  default     = null
}

variable "cloudops_shared_cognito_client_id" {
  description = "Existing Storefront public app client accepted by CloudOps after the owner enables shared administrator SSO."
  type        = string
  default     = null
}

variable "instance_type" {
  description = "EC2 instance type for the demo web server. Review current account and regional pricing before deployment."
  type        = string
  default     = "t3.micro"
}

variable "store_dynamodb_table_name" {
  description = "Existing DynamoDB table used by the Fieldwork Store API."
  type        = string
  default     = "fieldwork-store-commerce"
}

variable "cpu_threshold" {
  description = "CPU utilisation percentage that triggers the alarm."
  type        = number
  default     = 75
}

variable "alarm_evaluation_periods" {
  description = "Number of consecutive periods the threshold must be breached."
  type        = number
  default     = 1
}

variable "alarm_period_seconds" {
  description = "Length of each evaluation period in seconds."
  type        = number
  default     = 300
}

variable "alert_email" {
  description = "Email address for operational alerts (alarm notifications, Lambda errors). Leave empty to skip email alerts."
  type        = string
  default     = ""
}

variable "discord_webhook_url" {
  description = "Discord Webhook URL for ChatOps alerts. Leave empty to skip."
  type        = string
  default     = ""
}
