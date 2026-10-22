# ─────────────────────────────────────────────────────────────────────────────
# Terraform Provider & Data Sources
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket         = "self-healing-tfstate-cee9d484"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "self-healing-tfstate-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Account & region info (used for ARN construction) ─────────────────────
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# The commerce table was created and verified by the project owner before
# Batch 3A. Reference it without attempting to recreate or import it.
data "aws_dynamodb_table" "store_commerce" {
  name = var.store_dynamodb_table_name
}

# ── Latest Amazon Linux 2023 AMI via SSM Parameter Store ──────────────────
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# ── Default VPC & subnets (avoids creating VPC resources) ─────────────────
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ── Random suffix for globally-unique S3 bucket name ──────────────────────
resource "random_id" "bucket_suffix" {
  byte_length = 4
}
