# ─────────────────────────────────────────────────────────────────────────────
# S3 – Audit Log Bucket
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "audit_logs" {
  bucket        = "${var.project_name}-audit-logs-${random_id.bucket_suffix.hex}"
  force_destroy = true # allows terraform destroy to remove non-empty bucket

  tags = {
    Name    = "${var.project_name}-audit-logs"
    Project = var.project_name
  }
}

# ── Block all public access (defence-in-depth) ───────────────────────────
resource "aws_s3_bucket_public_access_block" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Server-side encryption (SSE-S3, free) ─────────────────────────────────
resource "aws_s3_bucket_server_side_encryption_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── Lifecycle rule: auto-delete objects after 90 days to stay within 5 GB ─
resource "aws_s3_bucket_lifecycle_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    id     = "expire-old-audit-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = 90
    }

    # Also expire old versions after 30 days to keep storage minimal
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ── Versioning: protect audit logs from accidental overwrites ─────────────
resource "aws_s3_bucket_versioning" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# S3 – Frontend Assets Bucket
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "frontend_assets" {
  bucket        = "${var.project_name}-frontend-${random_id.bucket_suffix.hex}"
  force_destroy = true

  tags = {
    Name    = "${var.project_name}-frontend-assets"
    Project = var.project_name
  }
}

resource "aws_s3_bucket_public_access_block" "frontend_assets" {
  bucket = aws_s3_bucket.frontend_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend_assets" {
  bucket = aws_s3_bucket.frontend_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
