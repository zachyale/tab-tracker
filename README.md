# Tab Tracker

[![release](https://img.shields.io/github/v/release/zachyale/tab-tracker?sort=semver)](https://github.com/zachyale/tab-tracker/releases)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![coverage](https://codecov.io/gh/zachyale/tab-tracker/branch/main/graph/badge.svg)](https://codecov.io/gh/zachyale/tab-tracker)

> **Note:** This is a personal project, open source for posterity. It comes with
> no guarantee of support or stability.

Self-hosted tab tracking for friend groups. Buying something in bulk? Put the QR code next to it,
friends tap **+** every time they take one, and everyone can see what they owe.

- **Accounts** are ledgers ("Home") with a custom URL (`/accounts/sample-home`),
  a currency, and a set of **options** (e.g. "Cold brew — $3.00").
- Logged-in visitors get **+/−** buttons per option; balances update instantly.
- Managers see every member's tab, can adjust quantities, record payments
  ("settle up"), export the ledger as CSV, and print a QR code.
- Append-only ledger: prices are locked at the moment each entry is
  recorded, so repricing an item never rewrites history.

## Quick start

```yaml
# docker-compose.yml
services:
  tab-tracker:
    image: ghcr.io/zachyale/tab-tracker:latest
    ports: ["3000:3000"]
    volumes: ["tab-tracker-data:/data"]
    environment:
      BETTER_AUTH_SECRET: <openssl rand -hex 32>
      BASE_URL: https://tabs.example.com
volumes:
  tab-tracker-data:
```

`docker compose up -d`, open the instance, and sign up — **the first user
becomes the instance admin**. Everything (SQLite database included) lives in
the `/data` volume; back it up by copying the volume.

## Configuration

All configuration is via environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | _(dev fallback)_ | **Required in production.** Session/token signing secret. |
| `BASE_URL` | `http://localhost:3000` | Public URL of the instance (OAuth callbacks, email links). |
| `PORT` | `3000` | Listen port. |
| `DATA_DIR` | `/data` (image) | Where the SQLite database lives. |
| `INSTANCE_NAME` | `Tab Tracker` | Shown in the header and emails. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Enable "Continue with Google". Callback URL: `<BASE_URL>/api/auth/callback/google`. |
| `OIDC_DISCOVERY_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | — | Enable a generic OIDC provider (Authentik, Keycloak, …). |
| `OIDC_PROVIDER_NAME` | `SSO` | Label for the OIDC login button. |
| `DEFAULT_AUTH_METHOD` | `password` | `oauth` leads the login page with provider buttons. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | Enable email verification and self-service password reset. Without SMTP, signups are active immediately. |

HTTPS is expected to be terminated by your reverse proxy (Caddy, Traefik, nginx).

## Development

```bash
npm install
npm run dev            # builds web once, runs the API with tsx watch on :3000
npm run dev -w web     # optional: Vite dev server on :5173, proxies /api to :3000
```

Stack: Hono + better-auth + Drizzle + SQLite on the server; React + Vite +
Tailwind on the client.

## Releases

Branch model: day-to-day commits land on **`develop`**; **`main`** only ever
receives release merges.

- All commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  — subject line only, no body. `fix:` → patch, `feat:` → minor, `feat!:`/`fix!:`
  → major.
- To cut a release, a repository **admin** runs the `release` workflow
  (Actions → release → Run workflow). It computes the next version from the
  conventional commits, commits the version bump + `CHANGELOG.md` to
  `develop`, and opens a PR from `develop` to `main`.
- **Merging that PR publishes the release**: the `tag-release` workflow tags
  `vX.Y.Z`, creates the GitHub Release with the changelog, and pushes a
  multi-arch (amd64/arm64) Docker image to `ghcr.io/zachyale/tab-tracker`
  tagged `X.Y.Z`, `X.Y`, and `latest`.
- The `docker` workflow can also be dispatched manually to (re)publish any
  existing tag.
