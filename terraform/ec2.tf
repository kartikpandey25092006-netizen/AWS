# ─────────────────────────────────────────────────────────────────────────────
# Security Group – allow HTTP (80) inbound, all outbound
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "web_server" {
  name        = "${var.project_name}-web-sg"
  description = "Allow HTTP inbound and all outbound for nginx + SSM agent"
  vpc_id      = data.aws_vpc.default.id

  # HTTP from anywhere (needed to verify nginx is running)
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # All outbound (SSM agent needs HTTPS outbound to AWS endpoints)
  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project_name}-web-sg"
    Project = var.project_name
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# EC2 Instance – t2.micro, Amazon Linux 2023, nginx via UserData
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_instance" "web_server" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.web_server.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name

  # Enable detailed monitoring = false → uses basic (free) 5-min metrics
  monitoring = false

  # Associate a public IP so we can hit nginx and SSM agent can reach AWS
  associate_public_ip_address = true

  user_data = <<-USERDATA
    #!/bin/bash
    set -euxo pipefail

    # Update packages
    dnf update -y

    # Install nginx, stress-ng, and cloudwatch agent
    dnf install -y nginx stress-ng amazon-cloudwatch-agent

    # Try to sync frontend assets if they exist in S3 (ignores errors if empty)
    aws s3 sync s3://${aws_s3_bucket.frontend_assets.id} /usr/share/nginx/html/ || true

    # Create health check endpoint (Feature 3)
    echo '{"status": "OK"}' > /usr/share/nginx/html/health

    # Ensure correct permissions
    chown -R nginx:nginx /usr/share/nginx/html
    chmod -R 755 /usr/share/nginx/html

    # Start nginx
    systemctl enable nginx
    systemctl start nginx

    # Configure CloudWatch Agent for Memory Monitoring
    cat << 'EOF' > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
    {
      "metrics": {
        "metrics_collected": {
          "mem": {
            "measurement": ["mem_used_percent"],
            "metrics_collection_interval": 60
          }
        }
      }
    }
    EOF

    # Start CloudWatch Agent
    /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
  USERDATA

  # Recreate instance if UserData changes
  user_data_replace_on_change = true

  root_block_device {
    volume_size           = 8 # GB – within Free Tier (30 GB allowance)
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name    = "${var.project_name}-web-server"
    Project = var.project_name
  }

  lifecycle {
    ignore_changes = [ami]
  }
}
