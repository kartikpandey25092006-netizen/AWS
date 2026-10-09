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
cd ..

if [ -z "$FRONTEND_BUCKET" ] || [ -z "$INSTANCE_ID" ]; then
    echo "❌ Error: Could not find Terraform outputs. Have you run 'terraform apply'?"
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
npm install
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

echo "✅ Deployment successful! Visit the EC2 Public IP."
