# AWS Self-Healing Infrastructure

## Overview
This document describes the monitoring and guarded recovery paths in the AWS environment. EC2 health and CPU/memory alarms notify an operator; the Health Manager can start the Store API only when its guarded recovery conditions are met.

---

### 1. CPU and Memory Alerts
* **Trigger:** CloudWatch alarms monitor EC2 CPU and memory metrics.
* **Mechanism:** An alarm publishes to SNS, which invokes the remediation **AWS Lambda function**.
* **Action:** The function records the alarm and asks an operator to review it. Simulated alarm tests do not create real CPU or memory pressure, and these alert handlers do not restart processes.

### 2. EC2 System Health Alert
* **Trigger:** A CloudWatch alarm detects `StatusCheckFailed_System` for the selected EC2 instance.
* **Action:** The alarm notifies the operations SNS topic. It does not configure the native EC2 recovery action; an operator reviews the incident.

### 3. EC2 Instance Health Alert
* **Trigger:** A CloudWatch alarm detects `StatusCheckFailed_Instance` for the EC2 instance.
* **Action:** The alarm notifies operators. The Health Manager reports EC2 health changes and does not reboot the instance.

### 4. Guarded Store API Recovery
* **Trigger:** The scheduled Health Manager observes a failed Store API proxy health check and confirms the API process is stopped or failed.
* **Action:** When recovery is enabled and retry/cooldown limits allow it, the Lambda sends the fixed, parameter-free SSM document to start the Store API and then verifies the external health check. It does not restart an already-active API process.

### 5. Audit Logging (S3)
* **Mechanism:** Automated remediation must be tracked. Every time the self-healing Lambda function intervenes to heal your server, it generates a detailed log file.
* **Action:** These timestamped logs are written directly into an encrypted, version-controlled **Amazon S3 Bucket**. This allows operations teams to perform root-cause analysis the next morning.

### 6. Fail-Safe "Watch the Watcher" Alarm
* **Trigger:** A dedicated CloudWatch Alarm monitors the self-healing Lambda function itself.
* **Mechanism & Action:** If the Lambda function throws an error or fails to execute properly, it triggers a separate Ops Notification alert. This ensures the operations team knows immediately if the automated healing mechanism is broken.

### 7. Centralized CloudWatch Dashboard
* **Mechanism:** All metrics, alarms, and system health statuses are aggregated into a single pane of glass.
* **Action:** Provides immediate visibility into the real-time state of the infrastructure without needing to navigate through multiple AWS console screens.
