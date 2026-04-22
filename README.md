# @rello-platform/sentry-init

Shared Sentry init for the Rello ecosystem. One package, one PII policy, one sample-rate table — used identically by every app and engine in the platform.

## Why this exists

Before this package, each of the 13 Rello-platform repos carried its own copy of `Sentry.init({ dsn, environment, tracesSampleRate: 0.1 })` boilerplate. That's 36 near-identical config files (three per Next.js app for server/client/edge, plus the inline init in Milo-Engine). When the platform's PII policy or sampling needs change, 36-file greps invite drift — one file gets updated, the others silently diverge, and the first sign is a leak in production.

This package is the durable answer: one source of truth, imported by every repo. Upgrading the policy means bumping this package's version.

## What it handles

- **DSN gate.** If `SENTRY_DSN` is absent (local dev), init is a no-op. Consumers call `initSentry(...)` unconditionally at boot.
- **Env-aware `tracesSampleRate`.** `production` → 0.1, `staging` → 1.0, anything else (dev, test) → 0.0.
- **`beforeSend` PII scrubber.** Strips emails and phone numbers from every string in the event payload, plus redacts known PII-keyed fields (`email`, `phone`, `name`, `firstName`, `lastName`, `mobile`, `fullName`, `displayName`, and variants). Mutates in place; never drops events; never throws.
- **Standard tag set.** `repo: <slug>` on every event, plus whatever you pass in `extraTags`.

## Installation

```bash
npm install github:rello-platform/sentry-init#v0.1.0
```

The package has zero runtime dependencies. You bring your own Sentry SDK:

- `@sentry/nextjs` for Next.js apps
- `@sentry/node` for Express / Node services

## Usage

### Next.js apps (`sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`)

```ts
import * as Sentry from "@sentry/nextjs";
import { initSentry } from "@rello-platform/sentry-init";

initSentry(Sentry, { repo: "rello" });
```

Use the same call in all three config files. The `@sentry/nextjs` SDK dispatches init to the correct runtime internally.

### Express services (e.g., Milo-Engine `src/index.ts`)

```ts
import * as Sentry from "@sentry/node";
import { initSentry } from "@rello-platform/sentry-init";

initSentry(Sentry, { repo: "milo-engine" });
```

Place this at the very top of the entry point, before any other imports that might throw during module load — that way the error handler is registered early.

### Adding custom options

If you need additional Sentry integrations, custom `tracesSampler`, or any other non-standard option, use `buildSentryOptions` and spread:

```ts
import * as Sentry from "@sentry/nextjs";
import { buildSentryOptions } from "@rello-platform/sentry-init";

Sentry.init({
  ...buildSentryOptions({ repo: "newsletter-studio" }),
  integrations: [/* custom */],
  // Your override wins
  tracesSampler: (ctx) => (ctx.name === "/api/webhook" ? 0.01 : 1.0),
});
```

The built-in `beforeSend` scrubber runs on every event regardless of override — spread wins for scalar keys, but `beforeSend` should not be replaced unless you're also scrubbing PII another way.

## `repo` tag values

Use the canonical platform slug where one exists (see `@rello-platform/slugs`):

| Repo | `repo` value |
|---|---|
| Rello | `rello` |
| Milo-Engine | `milo-engine` |
| Harvest-Home | `harvest-home` |
| Newsletter-Studio | `newsletter-studio` |
| HomeReady | `home-ready` |
| TheHomeStretch | `home-stretch` |
| The-Home-Scout | `home-scout` |
| Open-House-Hub | `open-house-hub` |
| The-Drumbeat | `the-drumbeat` |
| MarketIntel | `market-intel` |
| PathfinderPro | `pathfinder-pro` |
| The-Oven | `the-oven` |
| Content-Engine | `content-engine` |

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `SENTRY_DSN` | Yes (in prod/staging) | unset | If unset, init is a no-op. |
| `SENTRY_ENVIRONMENT` | No | `development` | `production`, `staging`, or any other string (dev). Drives sample rate. |

## Verification

After migrating a repo to this package, confirm:

1. `npx tsc --noEmit` passes.
2. A deploy to staging triggers a synthetic error (debug route or intentional throw). See `Debug-route pattern` below.
3. The error lands in the Sentry dashboard with `repo: <slug>` tag attached. The `repo` tag is the wiring proof — if it's missing, `initSentry(Sentry, { repo: "<slug>" })` never executed for that deploy.
4. The error message/stack does NOT contain any lead email or phone number — the scrubber should have replaced them with `[email]` / `[phone]`.
5. **Keyed-field redaction** — if the synthetic error uses `scope.setExtra("email", ...)` or `scope.setExtra("phone", ...)`, the Sentry dashboard should show those `extra.*` values as `"[redacted]"` (not the original string). The scrubber walks the full event recursively, not just the message/stack — keyed PII fields anywhere in the payload are replaced.

### Debug-route pattern (`/api/<something>` — not `/api/_debug/*`)

When writing a synthetic-error route in a Next.js app, avoid underscore-prefixed path segments — Next.js App Router silently excludes `_`-prefixed folders from routing, so `src/app/api/_debug/sentry-test/route.ts` returns 404 in prod. Use a flat, non-underscore path:

```ts
// src/app/api/sentry-smoke-test/route.ts  — NOT _debug/sentry-test
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (key !== "<your-hardcoded-UUID>") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  Sentry.withScope((scope) => {
    scope.setExtra("email", "bob@example.com");
    scope.setExtra("phone", "+15559998888");
    Sentry.captureException(new Error(
      "sentry smoke test — alice@example.com +15551234567"
    ));
  });
  return NextResponse.json({ ok: true });
}
```

Three of the Next.js spokes (Harvest-Home, The-Drumbeat, MarketIntel) additionally require a middleware `PUBLIC_PATHS` entry for any new `/api/<foo>` route — otherwise the session-auth middleware 401/307s before the handler runs. See `APP-AUDIT-AGENT-PROTOCOL.md` §2.23 for the full per-repo table.

## Not in scope (v0.1.0)

- **Per-handler `captureException` wiring.** Individual handlers that want to attach domain context (hashed leadId, enrollmentId, sendIdempotencyKey) should go through NA-013 Phase 2's `runStage()` structural wrapper, not call this package's functions directly. This package is foundation only.
- **Tests.** The PII scrubber is regex-based and deserves unit tests in a future version — add alongside the first bug report or before v1.0.0.
- **BetterStack / uptime monitors.** Out of scope — those are external infra, not SDK code.
