# One administrator sign-in for Storefront and CloudOps

The user requested direct access to CloudOps after Storefront administrator sign-in. Both apps now use the existing Storefront identity. The CloudOps link automatically continues the Cognito managed-login session without asking for credentials again while that session is valid. Administrator authorization remains enforced in the API.

This supersedes the separate CloudOps user setup described in `CLOUDOPS_ADMIN_ACCESS.md`. The existing Storefront `store-admin` membership is now the source of administrator permissions for both apps. No AWS configuration, deployment, or deletion has been performed by the assistant.

## Local changes already prepared

- `frontend/.env.local` points both applications at the existing Storefront pool/client. `VITE_API_URL` retains the current CloudOps API endpoint.
- `lambda/api.zip` has been rebuilt from `lambda/api.py` and verified to contain the current administrator group checks. The owner can upload this zip to the existing `self-healing-api` Lambda function.
- Storefront menu, footer, and order-page CloudOps links include only `sso=storefront`. Tokens and passwords are never transferred in links or copied between origins.
- CloudOps automatically requests authorization code + PKCE with `prompt=none` when entered through that link. It then checks its own token with `/api/session` before fetching data. A prior dashboard session is replaced with the current shared identity.
- A missing/expired Cognito SSO session shows a return-to-Storefront action instead of a second credential form or redirect loop. Direct visits without an SSO link still require an authorized administrator.
- Terraform has optional paired shared-pool/client variables and `cloudops-sso.tfvars.example`; these local files do not change AWS until the owner reviews and applies them. The authorizer depends on the updated Lambda so group enforcement is deployed before the trust switch.

Read-only AWS inspection on 2026-10-16 confirms that the Storefront client now includes both port 5174 callback and sign-out URLs. The active CloudOps API `va2k3u8mli` still has no `GET /api/session` route, uses integration payload format `1.0`, trusts the legacy CloudOps pool/client, and does not allow the port 5174 origins in CORS. This combination explains the current "Administrator access could not be verified" screen.

On 2026-10-17, Lambda `self-healing-api` reported a successful code update, but a direct read-only probe of `GET /api/session` without claims returned HTTP 200. The prepared `lambda/api.py` returns 401 for that probe. The live code hash also differs from the prepared zip. Treat the deployed function as still unprotected until the owner uploads `lambda/cloudops-admin-api-2026-10-17.zip` and a repeated probe returns 401. Do not switch the API authorizer to the shared customer/admin pool before that verification.

Later on 2026-10-17, the owner uploaded that exact package. The live Lambda code hash matches the prepared zip. Direct handler probes returned 401 without claims, 403 for a customer group, and 200 for exact `store-admin`. The Lambda group guard is verified; the remaining owner work is in API Gateway: payload format 2.0, protected `GET /api/session`, port 5174 CORS origins, and shared Storefront issuer/audience.

The owner then updated live integration `aa2nr2k` to payload format `2.0`; a read-only API Gateway check confirmed it. The protected `GET /api/session` route, CORS origins, and shared Storefront authorizer settings remain pending.

The owner then created GET `/api/session` and updated JWT authorizer `pj4ccy` to the shared Storefront issuer and audience. A read-only API check confirmed the session route has JWT authorization, but it has no integration target yet. Port 5174 CORS origins also remain pending.

The owner attached integration `aa2nr2k` to GET `/api/session`. Read-only API metadata confirms the route uses JWT authorizer `pj4ccy` and Lambda integration `aa2nr2k`; an unauthenticated live GET returned 401. Port 5174 CORS origins remain pending.

The owner added both local CloudOps CORS origins on 2026-10-17. Read-only API metadata confirms `http://localhost:5174` and `http://127.0.0.1:5174`; browser-style OPTIONS preflights from both returned 204 with the matching allow-origin plus `authorization`, `content-type`, GET, OPTIONS, and POST. Local Storefront, CloudOps, and Store API endpoints returned HTTP 200. The remaining validation is a real Storefront administrator session opening CloudOps and a customer direct-access denial.

## Owner steps — perform in this order

### 1. Deploy the group checks before trusting customer identities — verified

The owner uploaded `lambda/cloudops-admin-api-2026-10-17.zip` to **Lambda → `self-healing-api`** in the selected Region `us-east-1`. The direct probes above verified exact `store-admin` checks for the session route. The shared pool also contains customers, so these checks must remain in place.

In **API Gateway → HTTP API `va2k3u8mli`**, complete the existing backend setup:

- Its Lambda integration `aa2nr2k` targets `self-healing-api` and uses payload format `2.0`.
- `GET /api/session`, `GET /api/status`, and `POST /api/maintenance` all use the JWT authorizer. Add the session route if it is missing.
- CORS allows the exact CloudOps origins, including `http://localhost:5174` and `http://127.0.0.1:5174` for local work, and the actual deployed CloudOps HTTPS origin. Allow the `Authorization`/`Content-Type` headers and required methods. Avoid caching protected API responses.

If using Terraform instead of Console changes, review a plan using the values from `terraform/cloudops-sso.tfvars.example`. Apply only after reviewing the entire plan. The assistant has not run a plan/apply and Terraform CLI was unavailable locally.

### 2. Register CloudOps with the shared Storefront app client

Open **Cognito → `User pool - ktzshz` (`us-east-1_vP8QkD0ry`) → App clients → `fieldwork-storefront-spa`**.

Client ID: `5oumcah9a3gtomb24unutar9d9`.

The read-only check confirms these are already present in both allowed callback and sign-out URLs. If you use another browser host or deployed domain, add its exact URL in **Login pages → Edit**, preserving the existing entries:

```text
http://localhost:5174/
http://127.0.0.1:5174/
```

Add actual CloudOps HTTPS URLs when deploying. Preserve the existing authorization-code flow, public client without a secret, scopes, and other settings. The Storefront domain already uses managed login version `2`, which supports no-prompt SSO. The earlier URLs added to `self-healing-app-client` belong to the legacy pool; this flow uses `fieldwork-storefront-spa`.

### 3. Point CloudOps API trust at that same identity

In **API Gateway → `va2k3u8mli` → Authorization → `cognito-jwt-authorizer` (`pj4ccy`)**, after step 1 is deployed, set:

| Field | Value |
| --- | --- |
| Issuer | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_vP8QkD0ry` |
| Audience | `5oumcah9a3gtomb24unutar9d9` |
| Identity source | `$request.header.Authorization` |

Save and deploy as required for your API stage. Keep all protected routes attached to this authorizer. The backend continues to verify group membership using the authorizer's validated claims.

### 4. Use the shared administrator session

1. Open the Storefront and sign in through **Admin sign in** with your existing approved Storefront administrator.
2. Click **CloudOps**. It will briefly show **Opening CloudOps**, continue the existing Cognito session, verify admin permissions, and open the dashboard without a second password form.
3. Confirm customers see no CloudOps links and cannot access metrics or maintenance by navigating directly.

If the local Vite servers are not running, start `npm run dev:storefront` and `npm run dev:cloudops` in separate terminals from `frontend`. For deployed builds, configure `VITE_STOREFRONT_URL` and `VITE_CLOUDOPS_URL` with the real app URLs, and keep the Cognito authority/client values identical in both apps.

No-prompt SSO requires the browser's existing Cognito managed-login cookie. If that session has expired, sign in again through Storefront. Existing dashboard tokens can remain valid until they expire; this implementation does not claim immediate cross-origin sign-out or group-removal revocation.

## Local validation

`npm run test:cloudops-access` uses isolated local servers and mocks all OAuth/API responses. It covers shared-session success, old-session replacement, PKCE, customer rejection, expired-session recovery, server denial, link privacy, and the existing role/API/polling checks. These are local tests, not proof that the owner has activated AWS settings.

Reference: [Cognito authorization endpoint and `prompt=none`](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html).
