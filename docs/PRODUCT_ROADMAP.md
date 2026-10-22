# Portfolio Product Roadmap: CloudOps Store

## Product idea

Keep the existing self-healing CloudOps dashboard and add a small commerce application that it can monitor. The result is a portfolio project with two connected sides:

1. **Customer Storefront:** browse physical products, manage a cart, sign in, submit an order request without payment, and view or cancel the customer's own requested orders.
2. **CloudOps dashboard:** show infrastructure health and performance metrics for the project. Store administrators use a protected route in the Storefront, so this remains a two-frontend project.

This is a demonstration project with no payment system. Never collect or store card details in this project.

## Current progress

See IMPLEMENTATION_BATCHES.md for the ordered redesign and test criteria.

- The public storefront and Cognito-protected CloudOps dashboard now build as separate frontends.
- The Storefront calls the catalog API and includes verified Cognito login, customer order-history/cancellation, and administrator order-management routes. The Store API defaults to its DynamoDB commerce repository; owner-run table creation and live restart proof remain.
- Products are physical. Customers can cancel only their own `REQUESTED` orders; administrators control other changes and acceptance. Inventory changes only at acceptance.
- DynamoDB is the selected durable commerce data store. Its repository and controlled catalog seed are implemented locally. Batch 3A selects the existing EC2 instance as the initial runtime; owner-run table setup and restart verification come next after AWS project verification.
- The frontend uses the shadcn/ui Vite setup with local Button, Badge, Input, and Card primitives.

## Decisions recorded before implementation

These decisions are recorded in `docs/DECISIONS.md` before services or infrastructure change:

- Visitors may browse products and manage a local cart without signing in. Customers sign in to submit an order request, view their history, or cancel their own requested order.
- Products are physical. A complete shipping address is required before an administrator accepts an order; an administrator may correct it while the order remains requested.
- Store administrators belong to the Storefront `store-admin` group in a dedicated Storefront Cognito User Pool. Backend authorization, rather than a hidden UI control, enforces the role.
- There is no payment collection or payment processing.
- The initial queries are catalog/product lookup, a customer's newest-first order history, and an administrator's order queue. The dedicated DynamoDB commerce table and its two indexes support these access patterns.
- The owner reviews selected-Region availability, project verification, current pricing, and spend limits before creating DynamoDB or other paid resources.

The existing DynamoDB tables remain for CloudOps state and audit records. Commerce data uses a separate DynamoDB table with its own keys, indexes, permissions, and retention decisions.

## Target experience

### Customer pages

- **Store home:** featured products, category links, and a visible demo banner.
- **Catalog:** product cards, category filtering, and simple search.
- **Product detail:** image, description, price, availability, and add-to-cart action.
- **Cart:** quantity changes, item removal, subtotal, and an empty-cart state.
- **Order request:** submit a `REQUESTED` order with no payment step. A shipping address can be supplied at submission and must be complete before acceptance.
- **Order confirmation/history:** order ID, item summary, timestamp, shipping-address completeness, and a status of `REQUESTED`, `CANCELLED`, or `ACCEPTED`. Show Cancel only for the customer's own requested orders.

### Administrator and operator pages

- **Order management:** find requested orders, inspect their status, correct permitted requested-order details, and accept them only after a complete address and stock recheck.
- **CloudOps panel:** retain the current health, metrics, audit, and maintenance views. Add Store API availability, request/error trends, and order-request failure counts when the runtime exists.

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

1. Record the chosen physical-product and customer-access policy from the decision list above.
2. Draw the customer journey: home → catalog → cart → sign in → requested order → order history/cancellation.
3. Draw the administrator journey: sign in → requested-order management → acceptance.
4. List the data each page reads or changes and the access patterns for products, carts, inventory, and orders.
5. Choose a data model that supports those queries and safe order/inventory updates. Keep CloudOps audit/state data separate from the commerce domain unless there is a documented reason to combine them.
6. Record the architecture decision and update the product requirements before coding.

**Ready when:** the product type, actors, API actions, data queries, order lifecycle, payment exclusion, and data-store choice are written down. This phase is complete.

### Phase 2: Build a read-only storefront

1. Add a store landing page and product catalog using static demo data.
2. Add product detail pages and category/search behavior.
3. Add responsive and accessible loading, empty, and not-found states.
4. Keep the CloudOps dashboard reachable through a separate navigation entry.
5. Ask for review before making visual or architectural changes outside this scope.

**Ready when:** a visitor can browse the complete catalog on desktop and mobile without signing in or changing data.

### Phase 3: Add cart and requested orders

1. Add cart operations and validate product IDs and quantities on the server.
2. Calculate prices on the server from the catalog; never trust totals sent by the browser.
3. Create an order-request flow with no payment fields.
4. Make order creation safe to retry so a refresh or network retry does not create duplicate demo orders.
5. Add order confirmation and customer order history with ownership checks.
6. For physical products, do not reserve or decrement stock at request creation. Recheck and decrement stock atomically only when an administrator accepts the order.

**Ready when:** users can submit a requested order, see it in their own order history, and cannot read or modify another customer's order.

### Phase 4: Add administrator tools

1. Define an administrator role in the identity model.
2. Enforce the role in backend handlers for product, inventory, and order changes.
3. Add the smallest useful requested-order controls: permitted address/item correction and acceptance.
4. Add validation, audit records, and confirmation for sensitive changes.
5. Test customer, administrator, and unauthenticated requests separately.

**Ready when:** customers can shop but cannot perform admin actions, and authorized administrators can manage demo data.

### Phase 5: Connect commerce to CloudOps

1. Add structured logs and metrics for catalog, cart, order-request, and order API calls.
2. Track useful service indicators such as request count, error count, and latency; avoid recording passwords, tokens, or payment data.
3. Add dashboard panels and alarms for service availability and elevated error rates.
4. Add a safe synthetic check for browsing and order-request creation.
5. Define the recovery action for each failure. Do not automatically restart services for every application error.
6. Test each recovery path independently in a staging/demo environment.

**Ready when:** the operator can see a simulated store failure, identify the affected service, and verify the recorded recovery action.

### Phase 6: Portfolio polish and presentation

1. Add screenshots, a current architecture diagram, a short demo script, and clear setup/cleanup instructions.
2. Add unit tests for pricing, cart rules, order ownership, admin authorization, and API errors.
3. Add frontend tests for browsing, cart, checkout, and order history.
4. Run lint, tests, and a production build before asking for review.
5. Review a Terraform plan and cost implications before the project owner applies infrastructure changes.
6. Record known limitations: single EC2 origin, payment-free order requests, demo scale, and any unverified AWS behavior.

**Ready when:** another student can understand the problem, follow the demo, see tests pass, and reproduce the setup without guessing.

## Suggested implementation boundaries

- Keep the Storefront and CloudOps dashboard as distinct Vite apps. Keep Storefront customer and administrator routes in the same Storefront app.
- Keep all store reads/writes behind API routes. The browser must never access DynamoDB or AWS credentials directly.
- Keep customer and administrator authorization checks server-side.
- Keep the order-request flow free of payment fields and payment-provider integrations.
- Keep commerce records separate from operational audit records so each can use a suitable schema and retention policy.
- Keep the current single-EC2 hosting as a portfolio limitation until the app requires another architecture. Do not add load balancers, container platforms, or multiple regions just to make the diagram larger.

## User-led workflow

The project owner performs all AWS Console actions and applies Terraform. For every batch that needs AWS configuration, the assistant provides the exact Console or CLI steps, relevant files and settings, expected result, security and cost notes, and test checklist. The assistant may implement and test local project code. After the owner completes an AWS step, review the shared output or evidence before advancing. Do not change AWS resources or deploy without the owner's action.
