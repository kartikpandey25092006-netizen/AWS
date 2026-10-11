# Portfolio Product Roadmap: CloudOps Store

## Product idea

Keep the existing self-healing CloudOps dashboard and add a small commerce application that it can monitor. The result is a portfolio project with two connected sides:

1. **Customer storefront:** browse products, manage a cart, place a simulated order, and view order status.
2. **Operator console:** manage the store and see whether its infrastructure and important customer flows are healthy.

This is a demonstration project, not a production payment system. Start with a simulated checkout and test data. Never collect or store real card details in this project.

## Current progress

- The Vite frontend now opens on a simple Fieldwork demo storefront with a static catalog, category filters, search, local cart, and an explicitly simulated checkout.
- The CloudOps dashboard remains available from the Store navigation.
- The storefront does not persist cart/orders, process payments, reserve inventory, store newsletter addresses, or call a commerce API.
- The product cards depict physical-style objects, but the project owner has not chosen a physical/digital fulfillment model. No inventory schema or database decision has been made.
- The frontend uses the shadcn/ui Vite setup with local Button, Badge, Input, and Card primitives.

## Decisions to make before implementation

Write these down in `docs/DECISIONS.md` before choosing services or changing the infrastructure:

- Are the demo products physical, digital, or a mix? Physical products need stock and shipping status; digital products need a safe way to grant downloads after a demo purchase.
- Who can use the store: public demo visitors, signed-in customers, or both?
- Who can create products and change inventory? Use a separate administrator role from customer sign-in.
- Is checkout always simulated, or will a payment provider's test mode be added later?
- What are the key queries? Examples: find a product by its URL, list products by category, show a customer's orders newest-first, or show all orders needing fulfillment.
- What is the demo scale and budget? Keep the first version small and set a budget alert before adding paid services.

The existing DynamoDB tables are designed for CloudOps state and audit records. Do not put orders, products, and inventory into those tables without first defining their access patterns. Commerce data has relationships and operator queries; choose its data store only after answering the questions above.

## Target experience

### Customer pages

- **Store home:** featured products, category links, and a visible demo banner.
- **Catalog:** product cards, category filtering, and simple search.
- **Product detail:** image, description, price, availability, and add-to-cart action.
- **Cart:** quantity changes, item removal, subtotal, and an empty-cart state.
- **Demo checkout:** confirm the order with a clearly labeled simulated payment step; no card number or real payment credentials.
- **Order confirmation/history:** order ID, item summary, timestamp, and a simple status such as `PLACED`, `PROCESSING`, or `COMPLETED`.

### Administrator and operator pages

- **Product management:** create, edit, publish/unpublish, and archive products.
- **Inventory or digital fulfillment:** show stock for physical goods, or fulfillment state for digital goods.
- **Order management:** find orders, inspect their status, and advance the demo lifecycle.
- **CloudOps panel:** retain the current health, metrics, audit, and maintenance views. Add store API availability, request/error trends, and checkout success/failure counts.

The backend must enforce administrator permissions. Hiding an admin button in React is not authorization. Cognito authentication identifies the user; the backend must also check the user's role before allowing product, inventory, or order mutations.

## Build phases

### Phase 0: Finish the current foundation

1. Keep project documentation aligned with the actual Terraform and application behavior.
2. Validate maintenance requests and return safe error messages from the API.
3. Run the local backend and frontend checks.
4. Have the project owner review a Terraform plan and verify the deployed Cognito and CORS behavior.
5. Surface the existing API health score and show a recoverable API connection message.

**Ready when:** tests and the frontend build pass locally; the owner has verified the deployed API's authenticated and unauthenticated behavior; no AWS deployment is performed without the owner's review.

### Phase 1: Define the commerce MVP

1. Choose product type and customer access policy from the decision list above.
2. Draw the customer journey: home → catalog → product → cart → simulated checkout → order confirmation.
3. Draw the administrator journey: sign in → product/inventory/order management.
4. List the data each page reads or changes and the access patterns for products, carts, inventory, and orders.
5. Choose a data model that supports those queries and safe order/inventory updates. Keep CloudOps audit/state data separate from the commerce domain unless there is a documented reason to combine them.
6. Record the architecture decision and update the product requirements before coding.

**Ready when:** the product type, actors, API actions, data queries, demo payment behavior, and data-store choice are written down.

### Phase 2: Build a read-only storefront

1. Add a store landing page and product catalog using static demo data.
2. Add product detail pages and category/search behavior.
3. Add responsive and accessible loading, empty, and not-found states.
4. Keep the CloudOps dashboard reachable through a separate navigation entry.
5. Ask for review before making visual or architectural changes outside this scope.

**Ready when:** a visitor can browse the complete catalog on desktop and mobile without signing in or changing data.

### Phase 3: Add cart and simulated orders

1. Add cart operations and validate product IDs and quantities on the server.
2. Calculate prices on the server from the catalog; never trust totals sent by the browser.
3. Create a clearly labeled demo checkout with no real payment fields.
4. Make order creation safe to retry so a refresh or network retry does not create duplicate demo orders.
5. Add order confirmation and customer order history with ownership checks.
6. If products are physical, add a simple stock reservation and fulfillment state. If digital, add a demo fulfillment state without exposing files publicly.

**Ready when:** users can make a simulated order, see it in their own order history, and cannot read or modify another customer's order.

### Phase 4: Add administrator tools

1. Define an administrator role in the identity model.
2. Enforce the role in backend handlers for product, inventory, and order changes.
3. Add the smallest useful product editor and order-status controls.
4. Add validation, audit records, and confirmation for sensitive changes.
5. Test customer, administrator, and unauthenticated requests separately.

**Ready when:** customers can shop but cannot perform admin actions, and authorized administrators can manage demo data.

### Phase 5: Connect commerce to CloudOps

1. Add structured logs and metrics for catalog, cart, checkout, and order API calls.
2. Track useful service indicators such as request count, error count, and latency; avoid recording passwords, tokens, or payment data.
3. Add dashboard panels and alarms for service availability and elevated error rates.
4. Add a safe synthetic check for browsing and simulated checkout.
5. Define the recovery action for each failure. Do not automatically restart services for every application error.
6. Test each recovery path independently in a staging/demo environment.

**Ready when:** the operator can see a simulated store failure, identify the affected service, and verify the recorded recovery action.

### Phase 6: Portfolio polish and presentation

1. Add screenshots, a current architecture diagram, a short demo script, and clear setup/cleanup instructions.
2. Add unit tests for pricing, cart rules, order ownership, admin authorization, and API errors.
3. Add frontend tests for browsing, cart, checkout, and order history.
4. Run lint, tests, and a production build before asking for review.
5. Review a Terraform plan and cost implications before the project owner applies infrastructure changes.
6. Record known limitations: single EC2 origin, simulated payments, demo scale, and any unverified AWS behavior.

**Ready when:** another student can understand the problem, follow the demo, see tests pass, and reproduce the setup without guessing.

## Suggested implementation boundaries

- Keep the storefront and operator console as distinct areas of the app, even if they initially share one Vite build.
- Keep all store reads/writes behind API routes. The browser must never access DynamoDB or AWS credentials directly.
- Keep customer and administrator authorization checks server-side.
- Keep simulated checkout separate from any future payment-provider test integration.
- Keep commerce records separate from operational audit records so each can use a suitable schema and retention policy.
- Keep the current single-EC2 hosting as a portfolio limitation until the app requires another architecture. Do not add load balancers, container platforms, or multiple regions just to make the diagram larger.

## User-led workflow

The project owner performs all AWS Console actions and applies Terraform. For each task, the assistant should explain the goal, the exact files or console pages involved, the steps to perform, and the evidence to return. After the owner completes a step, review the diff, command output, or AWS Core state before giving the next step. Do not change AWS resources or deploy without a separate explicit request.
