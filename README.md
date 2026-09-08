# AyvaTech

Multilingual server-rendered storefront for [AyvaTech on Tap.az](https://tap.az/shops/ayvatech?user_id=31349132). Express 5, EJS, local JSON storage, SQLite sessions, Sharp image variants and Playwright checks. No GitHub token is needed or consumed by this architecture.

## Run locally

Use Node.js 24 LTS (the session store uses `node:sqlite`). Run all commands from the project root:

```sh
npm install
npm run build
npm start
```

Open http://localhost:3000. AZ is the first-visit language; RU and EN use `/ru/` and `/en/`. Language selection is remembered. Missing product translations use the actual AZ source text; they are not generated at request time.

## Administration and deployment

Inject these settings through your hosting platform's environment/secret manager, never through source code or browser JavaScript:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Unique strong administrator password, at least 12 characters |
| `SESSION_SECRET` | Independent cryptographically random session secret, at least 32 characters |
| `SITE_URL` | Public canonical origin, HTTPS required with production mode; no trailing slash |
| `NODE_ENV` | Set to `production` on the host |
| `PORT` | HTTP port; defaults to 3000 |
| `TRUST_PROXY` | Set to `1` only behind exactly one trusted reverse proxy |
| `DATA_DIR` | Optional server data directory; defaults to `data` |

Administration is disabled unless both secrets meet their minimum lengths. `/admin/login` and `/admin` provide login/logout, catalogue search and filters, product CRUD, publishing states, AZ/RU/EN fields, specifications, uploads and image ordering. A login is not required for the storefront. Production uses Secure, HttpOnly, SameSite session cookies; the host must provide HTTPS. Forms/API mutations require CSRF tokens and current catalogue revisions.

Deploy as a long-running Node server, **not** GitHub/GitLab Pages or ephemeral serverless storage. Persist and back up `data/` and `public/media/` together. Uploaded `admin-*` images and SQLite sessions are deliberately gitignored and must be backed up on the host. Use one shared local filesystem for the server and importer; the filesystem lock is not a distributed-database replacement. Stop writes before taking a consistent backup. Never expose the server port around a trusted proxy.

No deployment or domain provisioning is performed by the build command. Verify HTTPS, Secure cookies, proxy configuration and backups on the actual deployment before launch.

## Real catalogue import

```sh
npm run import:tap
```

The importer verifies the shop identity, follows every GraphQL pagination cursor, compares the unique listing count with the source total, fetches each listing, validates products and saves local image variants. `sourceId` / `sourceUrl` prevent duplicates. Only allowlisted HTTPS source hosts are fetched; failed/incomplete source reads do not replace the catalogue.

- `data/products.json`: storefront/admin catalogue.
- `data/source-products.json`: actual source values used for comparison.
- `data/shop.json`: source contacts, branding and shop data.
- `data/import-report.json`: **latest** import counters, not cumulative totals.
- `public/media/`: listing images, logo and cover, with responsive variants.

Source timestamps with offsets are normalized to UTC. Content updates preserve human RU/EN translations, slugs and publishing state. Timestamp-only listing bumps retain manual content edits. A source content change may replace manually edited AZ fields, prices, specifications and images. Listings absent from a later import are retained; review and archive them through administration. A deleted imported item will be added again if it remains in the source.

The importer currently requires the default `data` directory. Avoid concurrent imports. If an abruptly terminated process leaves `data/products.lock`, first confirm no server/importer is writing, then remove only that stale lock and retry. Keep backups: individual JSON files are atomically replaced, but the entire multi-file import is not a database transaction.

Product names, prices, descriptions, category values, specifications and photographs are source-backed. The homepage uses an editorial selection, not invented popularity/sales figures. No confirmed WhatsApp contact is exposed in the fetched shop data, so the site uses the actual published telephone instead of inventing a WhatsApp link.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`build` validates JavaScript syntax, compiles EJS templates, validates catalogue identities/schema and decodes local media metadata. This is an SSR application: it does not produce a static `dist` bundle.

E2E starts an isolated test server and data copy with temporary random credentials. It checks all published products in three languages, images, navigation, search/filters, pagination, gallery, SEO, sessions, authorization, CSRF, XSS escaping, and admin CRUD/uploads. Responsive checks cover 320, 375, 390, 430, 768, 1024 and 1440 px. Reports/screenshots are written to gitignored `.test-data/`; production product data is not edited. Screenshots support a separate human visual review; passing overflow checks is not a design-quality certification.

Admin descriptions are plain text and escaped in HTML, not executable rich HTML. Uploads accept only decoded JPEG/PNG/WebP and are re-encoded. Sitemap, robots, canonical URLs, hreflang, social metadata and Product/Offer/Breadcrumb/Store structured data are server-rendered. Set the real `SITE_URL` before indexing.
