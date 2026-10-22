# Batch 3A Store API runtime decision

## Selected runtime

Reuse the existing Amazon Linux 2023 EC2 instance for the first deployed Store API. Run the Node process as a dedicated non-login service user under `systemd`, listening only on `127.0.0.1:3100`. Nginx reverse proxies the Store API path to that loopback listener.

This choice reuses the project's current compute, Nginx, SSM access, CloudWatch Agent, and recovery workflow. It avoids adding an Application Load Balancer, Auto Scaling Group, container platform, or another continuously billed runtime before traffic or availability requirements justify them.

## Exposure boundary

- Local API health endpoint: `http://127.0.0.1:3100/health`.
- Public API path after the separate Storefront distribution is created: `https://<storefront-domain>/store-api/*`.
- CloudFront terminates viewer TLS.
- The Storefront CloudFront distribution forwards `/store-api/*` without caching and allows the API's required HTTP methods and headers.
- Nginx removes the `/store-api` prefix and forwards requests to the loopback API.
- CORS contains only the exact localhost and deployed Storefront origins.
- DynamoDB remains private to the Store API through the EC2 instance role.

The existing direct public HTTP ingress is a temporary limitation of the current stack. Before production use, restrict origin access to the selected delivery boundary and prevent clients from bypassing CloudFront.

## Process and logs

- `systemd` starts the Store API after networking, restarts it on failure with a bounded delay, and loads only non-secret configuration names and identifiers.
- Application output goes to `journald` and is forwarded to a dedicated CloudWatch Logs group after the owner approves retention and cost.
- The process runs from a versioned release directory rather than the Nginx document root.
- Deployment and rollback are owner-run through SSM. No SSH ingress is required.

## Runtime configuration

The service requires `AWS_REGION=us-east-1`, `STORE_DATABASE=dynamodb`, `STORE_DYNAMODB_TABLE=fieldwork-store-commerce`, the existing Cognito pool/client identifiers, and exact allowed Storefront origins. The EC2 role supplies temporary AWS credentials automatically.

Reviewable deployment templates are stored under `services/store-api/deploy/`: the hardened `systemd` unit, Nginx reverse-proxy location, and non-secret environment-file example. The owner copies and activates them through SSM only after the AWS gate succeeds.

## Batch 3A owner deployment — preparation

The live instance is `i-05873747f092327bf` (`self-healing-web-server`) in `us-east-1`. It is online in Systems Manager and uses `self-healing-ec2-profile`, whose role is `self-healing-ec2-ssm-role`. That role now has an inline policy scoped to the `fieldwork-store-commerce` table and its indexes.

The API source binds to `127.0.0.1` by default. The EC2 service unit pins Node.js 22 using AL2023's namespaced `/usr/bin/node-22` executable. Do not expose port 3100 in the security group. The service needs only the existing public Nginx listener on port 80; the public HTTPS route must wait until the Storefront CloudFront distribution has an uncached `/store-api/*` behavior.

1. In **S3**, open `self-healing-frontend-cee9d484` and upload `services/store-api/deploy/fieldwork-store-api-release-v2.zip` with object key `batch3a/fieldwork-store-api-release-v2.zip`. This package matches the current Store API source; the earlier v1 package contains an older `src/app.mjs`. All 11 Store API tests passed before preparing v2.
2. In **Systems Manager → Fleet Manager → Managed nodes**, select `i-05873747f092327bf` and open **Node actions → Start terminal session**.
3. First inspect the current host and Nginx configuration. Do not edit it yet:

   ```bash
   node --version 2>/dev/null || true
   sudo nginx -t
   sudo nginx -T 2>&1 | grep -nE 'server \{|include|listen|root'
   ```

4. Return the command output. The active Nginx server block needs to be identified before placing the `/store-api/` location, so the existing CloudOps site configuration is preserved.

After confirming the active Nginx configuration, continue with Node.js 22, the dedicated service user, release extraction, environment file, systemd unit, and local health check. Validate the API at `http://127.0.0.1:3100/health` from the EC2 session. Do not send Cognito bearer tokens to the instance's public HTTP address; wire the browser to the API only after the HTTPS CloudFront path has caching disabled and forwards authorization headers.

## Owner deployment progress — 2026-10-17

Owner terminal output confirms the EC2 runtime is installed: Node.js `v22.23.2`, dedicated `fieldwork-store-api` system user, release directory `/opt/fieldwork/store-api/releases/2026-10-17-v2`, and the `current` symlink. The downloaded ZIP checksum matched `c152fdb59911a42d3d527123978a66aa`, and `npm-22 ci --omit=dev --ignore-scripts` installed 32 dependencies.

The environment file contains the selected Region, commerce table, shared Cognito pool/client, loopback port 3100, and exact localhost/127.0.0.1 origins on ports 5173 and 5174. The owner installed and enabled the prepared systemd unit. `systemctl status` reports `active (running)` with `/usr/bin/node-22 src/server.mjs`.

Nginx's active port-80 server includes `/etc/nginx/default.d/*.conf`. That directory was empty before the owner added `store-api.conf` using the prepared reverse-proxy location. Nginx validation and graceful reload succeeded. Owner terminal requests returned HTTP 200 for loopback `/health`, direct `/api/products`, and Nginx `/store-api/api/products`; both catalog responses contained six products from DynamoDB.

These observations verify the API process, catalog read, and local proxy. They do not yet verify browser traffic through HTTPS, protected order operations, restart persistence, or application-specific monitoring. Next: owner-created Storefront HTTPS delivery and uncached `/store-api/*` forwarding, followed by frontend configuration and browser checks. No AWS changes were executed by the assistant.

## Availability boundary

This is a single-instance demonstration runtime. A failure or replacement causes an API interruption, but DynamoDB keeps commerce data durable. Batch 5 evaluates an ALB and Auto Scaling Group only if measured traffic or an explicit availability target requires them.

## Owner gate

Do not deploy this runtime until project verification completes, the DynamoDB table is active, catalog seeding and persistence verification succeed, and the least-privilege instance-role change has been reviewed. The owner performs every AWS and deployment change.
