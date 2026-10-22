# CloudOps Store frontends

This folder contains exactly two independently built React applications:

- `apps/storefront`: public catalog and cart, Cognito customer sign-in, customer order history/cancellation, and the protected Storefront administrator order route.
- `apps/cloudops`: Cognito-protected operations dashboard.

## Local configuration

Copy `.env.example` to `.env` and replace only the non-secret identifiers and URLs. Vite variables are shipped to the browser. Never place client secrets, passwords, access keys, session tokens, or JWTs in this file.

The Storefront remains browseable when Cognito variables are absent. Checkout, customer orders, and admin orders fail closed with a configuration message. The Store API defaults to `http://127.0.0.1:3100` for local development.

## Commands

Run from this directory:

```powershell
npm ci
npm run dev:storefront
npm run dev:cloudops
npm run build
npm run lint
npm run test:smoke
```

The development servers use ports 5173 and 5174. The preview servers used by the smoke test use ports 4173 and 4174. On this Windows host, set `PUPPETEER_EXECUTABLE_PATH` to the installed Edge executable when Puppeteer's bundled Chrome is unavailable.

The browser smoke test mocks only the public product response. Live Cognito customer/admin flows require the owner-run Storefront Cognito configuration described in `../docs/IMPLEMENTATION_BATCHES.md`.
