#!/bin/bash
set -eo pipefail

echo "🚀 Deploying React Frontend to EC2..."

# 1. Get the S3 bucket and EC2 Instance ID from Terraform
echo "🔍 Fetching AWS resources from Terraform..."
cd terraform
# We must ensure terraform outputs exist
FRONTEND_BUCKET=$(terraform output -raw s3_frontend_bucket)
INSTANCE_ID=$(terraform output -raw ec2_instance_id)
API_URL=$(terraform output -raw api_gateway_url)
COGNITO_AUTHORITY=$(terraform output -raw cognito_authority)
COGNITO_CLIENT_ID=$(terraform output -raw cognito_user_pool_client_id)
COGNITO_DOMAIN=$(terraform output -raw cognito_domain)
FRONTEND_URL=$(terraform output -raw cloudfront_domain)
FRONTEND_DISTRIBUTION_ID=$(terraform output -raw cloudfront_distribution_id)
cd ..

if [ -z "$FRONTEND_BUCKET" ] || [ -z "$INSTANCE_ID" ] || [ -z "$API_URL" ] || [ -z "$COGNITO_AUTHORITY" ] || [ -z "$COGNITO_CLIENT_ID" ] || [ -z "$COGNITO_DOMAIN" ] || [ -z "$FRONTEND_URL" ] || [ -z "$FRONTEND_DISTRIBUTION_ID" ]; then
    echo "Error: Required Terraform outputs are missing. Review the deployment and outputs before continuing."
    exit 1
fi

if ! aws sts get-caller-identity >/dev/null; then
    echo "Error: AWS CLI credentials are unavailable. Select the intended AWS_PROFILE and sign in first."
    exit 1
fi

cat <<EOF > frontend/.env.production
VITE_API_URL=$API_URL
VITE_COGNITO_AUTHORITY=$COGNITO_AUTHORITY
VITE_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
EOF


# 2. Build the React app
echo "📦 Building frontend..."
cd frontend
PUPPETEER_SKIP_DOWNLOAD=true npm ci --include=dev
npm run build
cd ..

# 3. Sync the build to the S3 bucket
echo "☁️  Uploading to S3 (s3://$FRONTEND_BUCKET)..."
aws s3 sync frontend/dist s3://$FRONTEND_BUCKET/ --delete

# 4. Command the EC2 instance to pull from S3 and restart Nginx
echo "🔄 Telling EC2 ($INSTANCE_ID) to sync from S3 and restart Nginx..."

COMMANDS='[
  "aws s3 sync s3://'"$FRONTEND_BUCKET"' /usr/share/nginx/html/ --delete",
  "aws s3 cp s3://'"$FRONTEND_BUCKET"'/index.html /usr/share/nginx/html/index.html",
  "chown -R nginx:nginx /usr/share/nginx/html",
  "chmod -R 755 /usr/share/nginx/html",
  "systemctl restart nginx"
]'

COMMAND_ID=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=$COMMANDS" \
    --comment "Deploy React Frontend" \
    --query "Command.CommandId" \
    --output text)

echo "⏳ Waiting for SSM command ($COMMAND_ID) to complete..."
aws ssm wait command-executed \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID"

INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$FRONTEND_DISTRIBUTION_ID" \
    --paths "/*" \
    --query "Invalidation.Id" \
    --output text)

echo "Waiting for CloudFront invalidation ${INVALIDATION_ID}..."
aws cloudfront wait invalidation-completed \
    --distribution-id "$FRONTEND_DISTRIBUTION_ID" \
    --id "$INVALIDATION_ID"

echo "Deployment successful. Open ${FRONTEND_URL}."
