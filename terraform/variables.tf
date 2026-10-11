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

variable "instance_type" {
  description = "EC2 instance type for the demo web server. Review current account and regional pricing before deployment."
  type        = string
  default     = "t3.micro"
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
