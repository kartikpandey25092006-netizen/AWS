# CloudOps administrator access

> **Superseded authentication setup:** The user subsequently requested one shared administrator login. Follow `CLOUDOPS_SSO_SETUP.md` for the current identity/callback/authorizer migration. The separate-pool instructions below describe the earlier setup; server group enforcement still applies.

## Local changes

- Storefront navigation, mobile menu, footer, and order pages show CloudOps links only to authenticated `store-admin` users.
- Opening CloudOps directly requires an access token with the exact `store-admin` group and successful verification through `GET /api/session`. No metrics polling or maintenance controls appear before approval. API failures and permission denials keep the dashboard closed.
- The CloudOps Lambda checks the trusted API Gateway JWT claims on `/api/session`, `/api/status`, and `/api/maintenance`. Customer claims, lookalike groups, and role/email fields do not grant access.
- The local Terraform files include the protected session route, explicit API Gateway payload format `2.0`, and CloudOps development callback/logout/CORS origins on port `5174`.

These are repository changes. No AWS configuration or deployment was performed. The currently deployed Lambda and frontend retain their previous behavior until the owner deploys these updates.

## Owner steps

Read-only AWS verification on 2026-10-16 identified the existing CloudOps configuration:

| Setting | Verified value |
| --- | --- |
| Cognito pool | `self-healing-user-pool` / `us-east-1_6CzGgG7Kn` |
| Public app client | `self-healing-app-client` / `2cmal8lvm5p3g0jfrgngqais3` |
| Issuer | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_6CzGgG7Kn` |
| Active CloudOps API | `https://va2k3u8mli.execute-api.us-east-1.amazonaws.com` |
| JWT authorizer | `pj4ccy` |
| Lambda integration | `aa2nr2k`, function `self-healing-api` |

These public values have been added to the local `frontend/.env.local`. API `j0bp7jh6v7` has the same name but no routes/integrations and a failed stage; it is not the current CloudOps API.

At verification, the CloudOps pool had no groups, its app client registered no port `5174` callbacks/logout URLs, and the active API had no `/api/session` route. Its integration was payload `1.0` and CORS did not allow port `5174`. Complete the owner steps below before attempting the full live login. No AWS settings were changed by this verification.

1. Confirm the selected Region is the project's assigned Region, currently `us-east-1`. In the existing **CloudOps** Cognito user pool, create or reuse the group named exactly `store-admin`. Add only approved CloudOps administrators. The Storefront and CloudOps pools are separate; adding someone to the Storefront group does not add them to the CloudOps group.
2. In the CloudOps public app client, preserve its existing settings and add the exact local callback and sign-out URLs you will use: `http://127.0.0.1:5174/` and/or `http://localhost:5174/`. Keep authorization-code/PKCE login and no client secret.
3. The verified CloudOps public settings are now supplied in `frontend/.env.local`, alongside the existing Storefront settings:

   ```dotenv
   VITE_COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_6CzGgG7Kn
   VITE_COGNITO_CLIENT_ID=2cmal8lvm5p3g0jfrgngqais3
   VITE_API_URL=https://va2k3u8mli.execute-api.us-east-1.amazonaws.com
   ```

   Use the values from your existing CloudOps resources, or the existing Terraform outputs `cognito_authority`, `cognito_user_pool_client_id`, and `api_gateway_url`. Do not copy the Storefront pool/client into these fields. The app stays on its configuration screen while its CloudOps settings are missing.
4. Review the local changes in `terraform/api.tf` and `terraform/cognito.tf` before applying them yourself, or make equivalent Console changes yourself. The CloudOps API integration must use payload format `2.0`. Keep the existing CloudOps JWT issuer and audience. Attach that JWT authorizer to **all three routes**: `GET /api/session`, `GET /api/status`, and `POST /api/maintenance`.
5. Configure API CORS for the exact CloudOps browser origins, including the chosen local port `5174` origin during development and the actual CloudOps HTTPS origin after deployment. Allow the `Authorization` and `Content-Type` headers. Origin values do not have a trailing slash.
6. Deploy the updated `lambda/api.py` and rebuild/deploy the updated CloudOps and Storefront frontends yourself. The paused legacy frontend deployment script should not be used to overwrite the combined origin. Restart the local CloudOps frontend with `npm run dev:cloudops` from `frontend` after adding its settings.
7. Sign out and sign in again after changing groups so Cognito issues updated tokens. Verify a customer sees no CloudOps links and receives an access-denied screen at the direct CloudOps URL. Verify an approved administrator sees the link, completes CloudOps login, and can load metrics. Confirm customer requests to the protected API routes return `403`, and unauthenticated requests return `401`.

CloudOps and Storefront have separate sessions and operator identities. Existing valid tokens retain their group claims until expiration; group removal is not an immediate revocation check on already-issued tokens.

## Local tests

From `frontend`, run `npm run test:cloudops-access`. It starts isolated local Vite servers on `5180` and `5181`, uses synthetic sessions, and mocks all external OAuth and API traffic. It does not use or change AWS resources. Set `PUPPETEER_EXECUTABLE_PATH` if an installed Chromium browser is needed.

Run the CloudOps Python suite with `python -m unittest discover -s lambda/tests -v` from the repository root. Its boto3 clients are mocked. Also run `npm run build` and `npm run lint` from `frontend`.
