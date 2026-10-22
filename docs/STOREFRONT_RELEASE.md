# Storefront release preparation — 2026-10-17

## Prepared artifact

- S3 destination: `fieldwork-storefront-325381793128`, selected Region `us-east-1`. The owner's screenshot confirms bucket creation; the requested private/versioned/encrypted settings have not been independently rechecked.
- Build directory: `frontend/dist/storefront/`.
- Archive: `frontend/deploy/fieldwork-storefront-2026-10-17.zip`.
- Release manifest: `frontend/deploy/fieldwork-storefront-2026-10-17.manifest.json`.
- Public production configuration template: `frontend/deploy/storefront.production.env.example`, copied to ignored `frontend/.env.production` for this build. Local development configuration remains in `.env.local`.

The production API base is `/store-api`, so requests use the Storefront's own origin. Public Cognito pool/client settings match the existing shared identity. CloudOps has no deployed HTTPS URL yet, so production admin CloudOps links are hidden until `VITE_CLOUDOPS_URL` is configured and the Storefront is rebuilt. Development retains the existing local dashboard address.

## Owner upload

1. Open the new Storefront bucket and choose Upload.
2. Add `index.html` from `frontend/dist/storefront/` and the entire `assets` folder from the same directory.
3. The bucket root must contain `index.html` and `assets/`; do not upload a parent `storefront/` directory or the ZIP as website content. S3 does not unpack ZIP files.
4. Keep Block Public Access enabled; CloudFront will use its origin access control.

The ZIP is a portable copy of those same files. If using it, extract it locally and upload its contents. Do not upload environment files, source files, or the release manifest as public website files.

## Verified locally

- Storefront TypeScript check and production build passed.
- Frontend lint passed with the four existing component-export warnings.
- Production JavaScript contains no localhost Store API or local CloudOps endpoint.
- A temporary local server served the built files and a mocked catalog endpoint. A headless browser requested `/store-api/api/products`, rendered the returned product, and reported no runtime errors. This does not establish live AWS connectivity or Cognito sign-in.
- All 11 archive files match their build-file SHA-256 hashes, with `index.html` at archive root.

## Live CloudFront setup — 2026-10-19

- Distribution: `EXOWA1YGQR32N` (`fieldwork-storefront`), `https://d3bswlvyu1uaz.cloudfront.net/`.
- Private S3 origin: `fieldwork-storefront-325381793128`, using CloudFront Origin Access Control. The bucket contains root `index.html` and `assets/` files.
- Default behavior redirects viewers to HTTPS and uses the S3 static-content cache policy. Default root object is `index.html`. The selected price class includes North America, Europe, Asia, the Middle East, and Africa.
- EC2 origin: `ec2-3-89-204-132.compute-1.amazonaws.com`, HTTP port 80.
- Catalog behavior: `/store-api/api/products*` routes to EC2, redirects viewers to HTTPS, allows only GET/HEAD/OPTIONS, and uses `CachingDisabled`. This keeps the current public product-list route uncached and does not expose order/admin write methods.
- WAF was left disabled because the creation wizard estimated about $14 per 10 million requests for the optional protection. CloudFront is pay-as-you-go; actual usage may incur charges.

## Verified live

- The CloudFront homepage loaded from the distribution domain.
- The storefront rendered all six products.
- `GET /store-api/api/products` through the CloudFront domain returned the six DynamoDB products.

## HTTPS API route without a custom domain — 2026-10-22

The Storefront production API base now uses same-origin `/api/...` calls. The distribution already has an `/api/*` behavior for the AWS-managed HTTPS `fieldwork-store-api-web` Lambda Web Function origin, so browser bearer tokens do not travel to the HTTP-only EC2 origin. The existing `/store-api/*` EC2 behavior remains limited to the public catalog until the owner removes or retires it.

Before relying on this route, the owner must confirm the Lambda Web Function runs the current commerce release, has the Store API Cognito and DynamoDB environment plus least-privilege role, and its resource policy allows the Storefront CloudFront distribution. The `/api/*` behavior must disable caching and forward `Authorization`, `Content-Type`, and `Idempotency-Key`. Upload the rebuilt Storefront files, then invalidate the distribution so browsers receive the new API path. The owner performs these AWS changes.

## Remaining before full storefront use

- The EC2 origin hop is HTTP. Keep protected account/order/admin API paths off `/store-api/*`; production Storefront code now calls the `/api/*` Lambda Web Function behavior instead.
- Add and validate the required Cognito callback/logout URLs for the CloudFront domain before testing sign-in.
- Configure SPA deep-link routing without rewriting API failures to `index.html`.
- Decide on WAF and CloudFront access logging, including their costs and protected log storage.
- CloudFront was created manually and is not yet reconciled with Terraform state/configuration. Do not apply Terraform CloudFront changes until the manual distribution is reconciled to avoid creating a duplicate.
- CloudOps remains on a separate origin; configure its shared SSO settings and `VITE_CLOUDOPS_URL` in a later release.
