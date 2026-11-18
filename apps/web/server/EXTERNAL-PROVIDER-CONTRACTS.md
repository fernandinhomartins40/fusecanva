# External provider contracts

These contracts are server-only and disabled by default. The editor's current Site preview and print sandbox stay local. Neither integration is invoked by opening a preview, configuring a print draft, or downloading its local specification.

The retained Site audit covers a local responsive preview and an unsubmitted SSO domain draft. It does not establish hosting, a public URL, custom Site domains, or domain ownership checks. The observed `Domínio` dialog is under team SSO settings; it is not a Site custom-domain flow. The print audit covers one business-card catalog and configuration, plus its editor handoff. It explicitly did not execute cart, checkout, payment, order, shipping, or fulfillment. The contracts below therefore add a provider boundary only; they do not claim audited provider behavior or price parity.

## Readiness

`GET /api/providers/status` reports whether each integration is configured and which environment-variable names are missing. It never returns endpoint URLs or credential values.

Both provider clients remain absent unless their endpoint and token are present. Endpoints must be HTTPS URLs without embedded user information. An incomplete or invalid configuration is treated as disabled; routes return HTTP 503 and do not invoke `fetch`.

## Site publication

Required server environment variables:

- `SITE_PUBLISHER_URL`: HTTPS URL for the provider's deployment-creation endpoint.
- `SITE_PUBLISHER_TOKEN`: bearer credential for that endpoint.

The application accepts `POST /api/sites/:documentId/publish` with `{ "slug": "my-site" }`. The signed-in user must have owner access to an active Site. The slug is normalized to lowercase and limited to 1–63 ASCII letters, digits, or internal hyphens. Hidden sections and presenter notes are excluded.

The configured endpoint receives a JSON `POST` with an `Authorization: Bearer …` header and `{ documentId, slug, site }`. It must return `{ "url": "https://…", "deploymentId": "…" }`. The application validates both fields and returns the public URL and deployment ID. Provider-specific hosting, URL namespace, deployment lifecycle, rate limits, custom domains, DNS, TLS, and rollback still need to be selected and implemented by the provider.

## Print checkout

Required server environment variables:

- `PRINT_CHECKOUT_URL`: HTTPS URL for the provider's checkout-session endpoint.
- `PRINT_CHECKOUT_TOKEN`: bearer credential for that endpoint.

The application accepts `POST /api/print/checkout` with `{ "documentId": "…", "options": { "format": "vertical-standard", "paper": "premium", "finish": "matte", "quantity": 150 } }`. The signed-in user must have owner access to an active design. Product is currently fixed to `business-card`; format, paper, finish, and quantity are validated against the local print sandbox option IDs. No client estimate is sent as a provider quote, and the route does not accept payment or shipping credentials.

The endpoint receives `{ documentId, product, options, document }` in a JSON `POST` with an `Authorization: Bearer …` header. It must return `{ "checkoutUrl": "https://…", "sessionId": "…" }`; the provider collects address and payment details on its own HTTPS checkout. Pricing, tax, shipping, inventory, production validation, payment authorization/capture, order state, refunds, and fulfillment remain provider responsibilities and are not established by the audit.

## Adapter interfaces and safety

`createAppServer` accepts optional server-side adapters for isolated deployments and tests:

- `sitePublisher.publish({ documentId, slug, site })` → `{ url, deploymentId }`
- `printCheckoutProvider.createCheckout({ documentId, product, options, document })` → `{ checkoutUrl, sessionId }`

Passing `null` explicitly disables an adapter. Tests inject in-memory fakes and a fetch stub that throws if called; they do not contact an external service. Provider errors are returned as generic 502 responses so provider credentials and response bodies remain private. Credentials belong in the server process environment or secret manager; they must never be put into `VITE_*` variables, browser storage, or client requests.
