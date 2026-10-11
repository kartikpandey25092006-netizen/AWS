#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Phase 3: Stress Test — Full Self-Healing Validation
# ═══════════════════════════════════════════════════════════════
#
# This script:
#   1. Injects CPU stress directly on the EC2 instance via SSM
#   2. Monitors CloudWatch alarm state in real-time
#   3. Checks the remediation Lambda and generates a report
#
# Usage:  ./phase3-stress.sh [--cpu-load 95] [--duration 360]
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TERRAFORM_DIR="$SCRIPT_DIR/../terraform"

# Get live values from Terraform
INSTANCE_ID=$(cd "$TERRAFORM_DIR" && terraform output -raw ec2_instance_id)
SITE_URL=$(cd "$TERRAFORM_DIR" && terraform output -raw cloudfront_domain)
ALARM_NAME=$(cd "$TERRAFORM_DIR" && terraform output -raw alarm_high_cpu)

CPU_LOAD=95
DURATION=360
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cpu-load) CPU_LOAD="${2:-}"; shift 2 ;;
    --duration) DURATION="${2:-}"; shift 2 ;;
    --help) echo "Usage: $0 [--cpu-load 1..100] [--duration 60..600]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ ! "$CPU_LOAD" =~ ^[0-9]+$ ]] || (( CPU_LOAD < 1 || CPU_LOAD > 100 )); then
  echo "CPU load must be an integer from 1 to 100." >&2
  exit 2
fi
if [[ ! "$DURATION" =~ ^[0-9]+$ ]] || (( DURATION < 60 || DURATION > 600 )); then
  echo "Duration must be an integer from 60 to 600 seconds." >&2
  exit 2
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Phase 3: Self-Healing Stress Test${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Instance:    ${CYAN}${INSTANCE_ID}${NC}"
echo -e "  Website:     ${CYAN}${SITE_URL}${NC}"
echo -e "  CPU Load:    ${YELLOW}${CPU_LOAD}%${NC}"
echo -e "  Duration:    ${YELLOW}${DURATION}s${NC}"
echo -e "  Alarm:       ${CYAN}${ALARM_NAME}${NC}"
echo ""

# ── Pre-flight Checks ────────────────────────────────────────
echo -e "${CYAN}[1/6]${NC} Pre-flight checks..."

# Check instance is running
STATE=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].State.Name' --output text)
if [ "$STATE" != "running" ]; then
  echo -e "${RED}✗ Instance is $STATE, not running. Aborting.${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Instance is running"

# Check alarm is currently OK
ALARM_STATE=$(aws cloudwatch describe-alarms --alarm-names "$ALARM_NAME" \
  --query 'MetricAlarms[0].StateValue' --output text)
echo -e "  ${GREEN}✓${NC} Alarm state: $ALARM_STATE"

# Check Nginx is responding
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${SITE_URL}/health" --connect-timeout 5 || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo -e "  ${GREEN}✓${NC} Nginx responding (HTTP $HTTP_CODE)"
else
  echo -e "  ${YELLOW}⚠${NC} Nginx returned HTTP $HTTP_CODE (may recover)"
fi

echo ""

# ── Step 1: Record baseline ──────────────────────────────────
echo -e "${CYAN}[2/6]${NC} Recording baseline metrics..."
BASELINE_CPU=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value="$INSTANCE_ID" \
  --start-time "$(date -u -v-5M '+%Y-%m-%dT%H:%M:%S')" \
  --end-time "$(date -u '+%Y-%m-%dT%H:%M:%S')" \
  --period 60 \
  --statistics Average \
  --query 'Datapoints | sort_by(@, &Timestamp) | [-1].Average' \
  --output text 2>/dev/null || echo "N/A")

echo -e "  Baseline CPU: ${CYAN}${BASELINE_CPU}%${NC}"
echo ""

# ── Step 2: Inject CPU stress via SSM ─────────────────────────
echo -e "${CYAN}[3/6]${NC} Injecting CPU stress on EC2 (${CPU_LOAD}% for ${DURATION}s)..."

SSM_RESPONSE=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[\"stress-ng --cpu 1 --cpu-load ${CPU_LOAD} --timeout ${DURATION}s &\"]" \
  --comment "Phase 3 Stress Test" \
  --query 'Command.CommandId' \
  --output text)

echo -e "  ${GREEN}✓${NC} SSM Command sent: ${SSM_RESPONSE}"
STRESS_STARTED=true
cleanup_stress() {
  if [[ "${STRESS_STARTED:-false}" == true ]]; then
    aws ssm send-command \
      --instance-ids "$INSTANCE_ID" \
      --document-name "AWS-RunShellScript" \
      --parameters 'commands=["pkill -x stress-ng || true"]' \
      --comment "Stop CloudOps portfolio stress test" >/dev/null 2>&1 || true
  fi
}
trap cleanup_stress EXIT
echo ""

# ── Step 3: Monitor alarm state ──────────────────────────────
echo -e "${CYAN}[4/6]${NC} Monitoring CloudWatch alarm (checking every 30s)..."
echo -e "  ${YELLOW}Waiting for alarm to transition to ALARM state...${NC}"
echo -e "  ${YELLOW}(This takes ~5 minutes due to CloudWatch evaluation period)${NC}"
echo ""

START_TIME=$(date +%s)
ALARM_TRIGGERED=false

for i in $(seq 1 20); do
  CURRENT_STATE=$(aws cloudwatch describe-alarms --alarm-names "$ALARM_NAME" \
    --query 'MetricAlarms[0].StateValue' --output text)
  
  ELAPSED=$(( $(date +%s) - START_TIME ))
  MINS=$((ELAPSED / 60))
  SECS=$((ELAPSED % 60))
  
  if [ "$CURRENT_STATE" = "ALARM" ]; then
    echo -e "  ${RED}🔥 ALARM triggered at ${MINS}m ${SECS}s!${NC}"
    ALARM_TRIGGERED=true
    break
  fi
  
  echo -e "  [${MINS}m ${SECS}s] Alarm state: ${GREEN}${CURRENT_STATE}${NC}"
  sleep 30
done

echo ""

# ── Step 4: Check Lambda execution ──────────────────────────
echo -e "${CYAN}[5/6]${NC} Checking Lambda remediation logs..."

if [ "$ALARM_TRIGGERED" = true ]; then
  # Wait a moment for Lambda to execute
  sleep 15
  
  echo "  Recent Lambda logs:"
  aws logs tail "/aws/lambda/self-healing-remediation" --since 10m --format short 2>/dev/null | tail -5 || echo "  (no recent logs found)"
  echo ""
  
  # Check audit logs in S3
  AUDIT_BUCKET=$(cd "$TERRAFORM_DIR" && terraform output -raw s3_audit_bucket)
  echo "  Recent S3 audit logs:"
  aws s3 ls "s3://${AUDIT_BUCKET}/remediation-logs/" --recursive 2>/dev/null | sort | tail -3 || echo "  (no audit logs)"
else
  echo -e "  ${YELLOW}⚠ Alarm did not trigger within monitoring window.${NC}"
  echo -e "  ${YELLOW}  The stress test is still running on the instance.${NC}"
  echo -e "  ${YELLOW}  Run ./monitor.sh to continue watching.${NC}"
fi

echo ""

# ── Step 5: Post-test report ─────────────────────────────────
echo -e "${CYAN}[6/6]${NC} Generating report..."

FINAL_ALARM=$(aws cloudwatch describe-alarms --alarm-names "$ALARM_NAME" \
  --query 'MetricAlarms[0].StateValue' --output text)

END_TIME=$(date +%s)
TOTAL_TIME=$(( END_TIME - START_TIME ))

mkdir -p "$SCRIPT_DIR/results"
cat > "$SCRIPT_DIR/results/phase3-report.json" <<EOF
{
  "phase": "Phase 3 - Stress Test",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "instance_id": "${INSTANCE_ID}",
  "cpu_load_injected": "${CPU_LOAD}%",
  "stress_duration_seconds": ${DURATION},
  "baseline_cpu": "${BASELINE_CPU}",
  "alarm_triggered": ${ALARM_TRIGGERED},
  "final_alarm_state": "${FINAL_ALARM}",
  "monitoring_duration_seconds": ${TOTAL_TIME}
}
EOF

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Results Summary${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  Baseline CPU:         ${CYAN}${BASELINE_CPU}%${NC}"
echo -e "  Stress injected:      ${YELLOW}${CPU_LOAD}%${NC}"
echo -e "  Alarm triggered:      $([ "$ALARM_TRIGGERED" = true ] && echo -e "${RED}YES${NC}" || echo -e "${GREEN}NO (yet)${NC}")"
echo -e "  Final alarm state:    ${FINAL_ALARM}"
echo -e "  Test duration:        ${TOTAL_TIME}s"
echo -e "  Report saved:         results/phase3-report.json"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
