#!/usr/bin/env bash
# ==============================================================================
# Launch a dedicated EC2 instance for Polymarket Sniper in Jakarta (ap-southeast-3)
# Uses profile 'personal' configured in ~/.aws/credentials
# ==============================================================================

set -e

PROFILE="personal"
REGION="ap-southeast-3"
INSTANCE_NAME="polymarket-btc-sniper"
INSTANCE_TYPE="t3.nano" # Low cost: ~0.0052 USD/hour (~$3.8/month)

echo "🔍 Finding latest Ubuntu 24.04 LTS AMI in $REGION..."
AMI_ID=$(aws ssm get-parameter \
  --profile "$PROFILE" \
  --region "$REGION" \
  --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id" \
  --query "Parameter.Value" \
  --output text 2>/dev/null || echo "")

if [ -z "$AMI_ID" ]; then
  # Fallback query directly via ec2 describe-images
  AMI_ID=$(aws ec2 describe-images \
    --profile "$PROFILE" \
    --region "$REGION" \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
    --query "sort_by(Images, &CreationDate)[-1].ImageId" \
    --output text)
fi

echo "✅ Found AMI: $AMI_ID"

# Prepare User Data script that auto-installs and launches the bot on boot
USER_DATA=$(cat <<'EOF'
#!/bin/bash
set -e
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1
echo "Starting Polymarket Sniper auto-provisioning..."

apt-get update -y
apt-get install -y curl git build-essential

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

# Clone repo and start bot under ubuntu user
su - ubuntu -c "git clone -b arena/01a0cdb5-btc-updown https://github.com/jampongsathorn/btc-updown.git /home/ubuntu/btc-updown"
su - ubuntu -c "cd /home/ubuntu/btc-updown && npm install && npm run build"
su - ubuntu -c "pm2 start /home/ubuntu/btc-updown/dist/index.js --name btc-sniper --time"
su - ubuntu -c "pm2 save"
env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
pm2 save

echo "Polymarket Sniper deployment complete!"
EOF
)

# Base64 encode user data
ENCODED_USER_DATA=$(echo "$USER_DATA" | base64 | tr -d '\n')

echo "🚀 Launching EC2 instance '$INSTANCE_NAME' in $REGION..."
INSTANCE_ID=$(aws ec2 run-instances \
  --profile "$PROFILE" \
  --region "$REGION" \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --user-data "$ENCODED_USER_DATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=Project,Value=PolymarketSniper}]" \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":15,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --query "Instances[0].InstanceId" \
  --output text)

echo "===================================================================="
echo "🎉 SUCCESS! Instance launched: $INSTANCE_ID"
echo "Region: $REGION (Jakarta)"
echo "Type:   $INSTANCE_TYPE"
echo ""
echo "The instance will automatically boot up, install Node.js, and start"
echo "the Polymarket sniper bot in 2-3 minutes."
echo "You can monitor the instance in AWS Console or via:"
echo "aws ec2 describe-instances --profile $PROFILE --region $REGION --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].State.Name'"
echo "===================================================================="
