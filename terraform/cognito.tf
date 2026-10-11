# ─────────────────────────────────────────────────────────────────────────────
# Amazon Cognito Resources for SPA Authentication
# ─────────────────────────────────────────────────────────────────────────────

# ── User Pool ──────────────────────────────────────────────────────────────
resource "aws_cognito_user_pool" "pool" {
  name = "${var.project_name}-user-pool"

  alias_attributes         = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "email"
    required                 = true

    string_attribute_constraints {
      min_length = 3
      max_length = 256
    }
  }

  tags = { Project = var.project_name }
}

# ── User Pool Domain (Hosted UI) ──────────────────────────────────────────
resource "aws_cognito_user_pool_domain" "domain" {
  domain       = "${var.project_name}-auth-${random_id.bucket_suffix.hex}"
  user_pool_id = aws_cognito_user_pool.pool.id
}

# ── User Pool Client (SPA Public Client with PKCE) ────────────────────────
resource "aws_cognito_user_pool_client" "client" {
  name         = "${var.project_name}-app-client"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = [
    "https://${aws_cloudfront_distribution.frontend.domain_name}/",
    "http://localhost:5173/"
  ]

  logout_urls = [
    "https://${aws_cloudfront_distribution.frontend.domain_name}/",
    "http://localhost:5173/"
  ]



  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
}

