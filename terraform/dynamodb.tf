# ─────────────────────────────────────────────────────────────────────────────
# DynamoDB Table – Serverless Audit Logging
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "audit_logs" {
  name         = "${var.project_name}-logs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "instance_id"
  range_key    = "timestamp"

  attribute {
    name = "instance_id"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  tags = {
    Project = var.project_name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# DynamoDB Table – Self-Healing State
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "state_table" {
  name         = "${var.project_name}-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "resource_id"

  attribute {
    name = "resource_id"
    type = "S"
  }

  tags = {
    Project = var.project_name
  }
}
