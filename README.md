# AyvaTech — static Vercel + GitHub storage

Multilingual storefront for [AyvaTech on Tap.az](https://tap.az/shops/ayvatech?user_id=31349132). **No separate server, Express, database or persistent server filesystem.** Node.js 24 LTS, EJS static generation, Sharp, and one Node serverless function for administration.

```text
Public browser → Vercel CDN → dist HTML / local images
Build → data/products.json (no network or secrets)
Admin browser → /api/admin/* → authenticated Node function → GitHub API
                                                        → JSON / image commits
```

## Local commands

```sh
npm install
npm run build
npm run dev
```

`npm run dev` is only a loopback-bound local preview, not the deployment architecture. Open http://127.0.0.1:3000. Builds produce `dist/`; public pages work with **all GitHub/admin environment variables absent**. Public catalogue filtering/pagination uses a browser-safe module and embedded published data; no authenticated GitHub request. AZ is the default, RU/EN have `/ru/` and `/en/` URLs. Language preference uses localStorage; absent translations fall back to real AZ source text.

## Vercel setup

1. Connect `KA71337/ayvatech`, production branch `main`, to Vercel's Git integration.
2. Select **Other** (no Express preset), Node.js **24.x**, repository root as Root Directory. Remove stale project overrides for entrypoint/output/build commands. `vercel.json` specifies `npm install`, `npm run build`, and output `dist`.
3. Set the environment values below in Vercel Project Settings → Environment Variables. Production admin must point to the same repository/branch from which Vercel builds. Use a separate branch/token for preview writes or leave preview admin disabled.
4. Redeploy after changing configuration. Verify Vercel actually builds GitHub commits made by the token owner (Git integration access, branch rules, commit author and deployment permissions). Static publication depends on that integration.
5. Configure Vercel Firewall rate limiting for `/api/admin/login`. The function's in-memory limiter is only best-effort per instance, **not shared brute-force protection**. If unavailable on your plan, restrict admin access at the edge before enabling it publicly.

### Environment template (no secrets)

Copy `.env.example` when configuring a local or hosted environment. Never commit real credentials.

```dotenv
GITHUB_TOKEN=
GITHUB_OWNER=KA71337
GITHUB_REPO=ayvatech
GITHUB_BRANCH=main
GITHUB_PRODUCTS_PATH=data/products.json
ADMIN_PASSWORD=
SESSION_SECRET=
SITE_URL=https://ayvatech.vercel.app
```

Set `GITHUB_REPO=ayvatech` for this repository. Use a fine-grained GitHub token limited to this repository with **Contents: Read and write** permission. Store it only as a server-side `GITHUB_TOKEN`, never `NEXT_PUBLIC_*`. Neither the browser bundle nor HTML/API responses receive it. Do not paste secrets into issues, logs or chat.

`ADMIN_PASSWORD` must be unique and at least 16 characters. `SESSION_SECRET` must be independent, cryptographically random, at least 32 characters. Optional `SITE_URL` defaults to `https://ayvatech.vercel.app`; change it to the real HTTPS canonical origin when using a custom domain. Set it to the corresponding origin for each enabled admin deployment so CSRF origin checks match. Local preview accepts secrets already injected in the process environment; it does not read `.env` files.

### Sessions and API

A one-hour, HMAC-signed session cookie is verified **server-side on every admin request**. Production uses Secure, HttpOnly, SameSite=Strict. Password rotation invalidates all cookies. Logout clears the browser cookie; as with other stateless sessions, a stolen cookie remains valid until expiry or secret/password rotation. Mutation requests require a session-bound CSRF token and same-origin checks. No SQLite/Redis/session database is used.

The only deployed function is `api/admin.js`; rewrites provide:

- `GET /admin/login`, `GET /admin`, `GET /admin/product/new`, `GET /admin/product/:id`
- `POST /api/admin/login`, `POST /api/admin/logout`
- `GET /api/admin/products`, `POST /api/admin/products` (create)
- `GET`, `PUT`, `DELETE /api/admin/products/:id`
- `POST /api/admin/images` (necessary authenticated image upload)

The original JSON format is preserved: `data/products.json` is an **array**, not an object wrapper. Contents API SHA checks reject conflicting writes with HTTP 409. Source identities survive edits and duplicates are rejected. Input/schema errors return 400, unauthenticated calls 401, CSRF errors 403, missing products/files 404, oversized payloads 413, login throttling 429, missing configuration 503 and GitHub upstream failures 502/503. Logs contain only a request ID and safe status/error code, never headers, passwords, tokens, upstream bodies or stack traces.

### Saving and images

A successful save means **committed to GitHub**, not yet published to the CDN. The public site and new image URLs update only after Vercel finishes deploying the commit. Until then the previous deployment stays available. Preview environment deployments do not update the production domain. Check deployments if a saved change is not visible.

Admin uploads accept one decoded JPEG/PNG/WebP per API request, **maximum 2 MB**, safely below Vercel's request limit after base64 encoding. Images are re-encoded in memory to 320/640/1280px WebP, committed to `public/media/` through GitHub Git objects and a non-force ref update, never written to the function filesystem. Immediate upload preview uses returned image data; reloading before deployment may show an unavailable new image. Reordering/removing product image references is supported; unreferenced image files are retained in Git history/repository to avoid deleting shared assets. Only referenced media is copied into the public build.

## Existing real catalogue and importer

The retained snapshot has 45 products and 59 product photos, with titles, prices, descriptions, categories, specs, source IDs/URLs and locally stored image variants. Build validates the actual catalogue and decodes all referenced assets. No product images rely on temporary Tap.az URLs.

- `data/products.json`: authoritative catalogue, versioned in GitHub.
- `data/source-products.json`: original source snapshot for comparison.
- `data/shop.json`: source contacts and branding.
- `data/import-report.json`: latest import counters, not cumulative totals.
- `public/media/`: product/brand images and responsive variants.

Run `npm run import:tap` **locally**, not in serverless execution, only after synchronizing the branch with GitHub admin commits. It verifies shop identity, follows all pagination cursors, checks unique listings against the source total, fetches all listing details/photos, and refuses partial catalogue replacement. `sourceId`/`sourceUrl` prevent duplicates. Keep the default `data` directory and avoid concurrent imports. The filesystem lock belongs only to local importer/test tooling, never the deployed admin. Validate and commit/push the resulting JSON/assets deliberately to trigger publication.

Source content changes may replace manually edited AZ fields, prices, specs and images. Human RU/EN translations, slugs and publication state survive imports; timestamp-only bumps preserve manual content. Missing source listings are retained for review. Deleted imported items can return on the next import. Individual JSON files are replaced atomically, not as a multi-file transaction. Keep backups/Git history.

## Verification and incident diagnosis

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Tests exercise the real session/API/GitHub client code with a **simulated GitHub HTTP boundary** and isolated persisted files; they do not prove production credentials or real GitHub writes. E2E checks 135 localized product responses, all product images, 112 responsive pages at 320–1440px, filters, prices, language links, gallery, metadata, sitemap/robots, authorization, CSRF, escaping, CRUD, uploads/reordering, and static publication only after rebuild. Reports/screenshots stay in ignored `.test-data/`. The real catalogue is not edited by tests.

The previous entrypoint required HTTPS `SITE_URL` during module initialization and initialized SQLite sessions in a writable local directory. Both are inappropriate startup dependencies for this deployment; Express detection also routed public pages through a function. The unfinished migration additionally had a reproducible duplicate `filterProducts` export that prevented importing both build and admin modules. The new architecture removes these dependencies. The original production `FUNCTION_INVOCATION_FAILED` exception still requires Vercel runtime logs to identify conclusively; the HTTP error alone is not a stack trace.

After deployment verify `/`, `/catalog`, a real `/product/:slug`, `/about`, `/contacts`, `/admin/login`, login/CRUD/uploads and subsequent GitHub commits/deployments. Missing credentials must disable only administration, never the public site. Build/test success is not evidence that Vercel's project settings or GitHub integration are configured.
