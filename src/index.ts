/**
 * @rello-platform/sentry-init
 *
 * Single source of truth for Sentry init across the Rello ecosystem.
 * Consumers bring their own Sentry SDK (@sentry/nextjs for Next.js apps,
 * @sentry/node for Express) and call `initSentry(Sentry, { repo })`.
 *
 * What this package enforces fleet-wide:
 *   - `SENTRY_DSN` gate: if absent, init is a no-op (local dev stays quiet).
 *   - Env-aware `tracesSampleRate`: production=0.1, staging=1.0, dev=0.0.
 *   - `beforeSend` PII scrubber: emails, phone numbers, and known PII-keyed
 *     fields (email/phone/name/firstName/lastName/mobile/fullName/displayName)
 *     are redacted before the event leaves the process.
 *   - Standard tag set: at minimum `repo: <slug>` so dashboard slices are
 *     uniform across 13 services.
 *
 * Drift becomes mechanically impossible: there is exactly one scrubber
 * and exactly one sample-rate table. Upgrading the platform's PII policy
 * means bumping this package's version and re-installing, not grepping
 * 13 repos.
 */

export interface SentryInitOptions {
  /**
   * Canonical repo identifier. Use platform slugs where they exist
   * ("rello", "milo-engine", "harvest-home", etc.) — this becomes the
   * `repo` tag on every event for fleet-wide dashboard filtering.
   */
  repo: string;

  /**
   * Override environment. Defaults to `process.env.SENTRY_ENVIRONMENT`,
   * falling back to "development". Accepted values for sample-rate
   * selection: "production", "staging", anything else → dev rate.
   */
  environment?: string;

  /**
   * Additional tags to merge into `initialScope.tags` alongside `repo`.
   * Keep values non-PII (don't put `tenantId` here if tenants are
   * customer-identifying; a hash is fine).
   */
  extraTags?: Record<string, string>;

  /**
   * Override the DSN resolution. Defaults to `process.env.SENTRY_DSN`.
   * Useful for multi-project setups where a repo routes events to a
   * different Sentry project than the env-var default.
   */
  dsn?: string;
}

/**
 * Minimal duck-typed shape both @sentry/nextjs and @sentry/node satisfy.
 * The package does not import either SDK — consumers pass their own.
 */
export interface SentryLike {
  init(options: Record<string, unknown>): void;
}

/**
 * Build the Sentry.init options object without actually calling init.
 * Exported for consumers who need to layer additional options (custom
 * integrations, tracesSampler, etc.) — spread this first, then override.
 */
export function buildSentryOptions(opts: SentryInitOptions): Record<string, unknown> {
  const environment =
    opts.environment ?? process.env.SENTRY_ENVIRONMENT ?? "development";
  const dsn = opts.dsn ?? process.env.SENTRY_DSN;

  return {
    dsn,
    environment,
    tracesSampleRate: resolveSampleRate(environment),
    beforeSend: scrubPiiBeforeSend,
    initialScope: {
      tags: {
        repo: opts.repo,
        ...(opts.extraTags ?? {}),
      },
    },
  };
}

/**
 * Initialize Sentry with the platform-standard options. No-op if
 * `SENTRY_DSN` is absent (common in local dev) so consumers can call
 * this unconditionally at boot.
 */
export function initSentry(Sentry: SentryLike, opts: SentryInitOptions): void {
  const options = buildSentryOptions(opts);
  if (!options.dsn) return;
  Sentry.init(options);
}

// ---------------------------------------------------------------------------
// Sample-rate policy
// ---------------------------------------------------------------------------

export function resolveSampleRate(environment: string): number {
  if (environment === "production") return 0.1;
  if (environment === "staging") return 1.0;
  return 0.0;
}

// ---------------------------------------------------------------------------
// PII scrubber
// ---------------------------------------------------------------------------

// E.164 (+15551234567) and common US-format phone numbers. Deliberately
// narrow to keep false positives (e.g., order IDs, timestamps) minimal.
const PHONE_RE =
  /(?:\+\d{10,15}|\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})/g;

// Emails. Not RFC-complete but catches the shapes we'd actually log
// (alice@example.com, kelly.d.sansom+rello@gmail.com, etc.).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const PII_KEYS: ReadonlySet<string> = new Set([
  "email",
  "emailAddress",
  "phone",
  "phoneNumber",
  "mobile",
  "mobileNumber",
  "name",
  "firstName",
  "lastName",
  "fullName",
  "displayName",
  "customerEmail",
  "leadEmail",
  "agentEmail",
  "contactEmail",
]);

export function scrubString(input: string): string {
  return input.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

/**
 * `beforeSend` hook. Mutates the event in place and returns it. Never
 * throws — a throwing beforeSend silently drops every event. Returning
 * `null` would also drop events; we return the (scrubbed) event so the
 * stack trace still reaches Sentry with PII stripped out.
 */
export function scrubPiiBeforeSend<T extends object>(event: T): T {
  try {
    deepScrub(event, 0);
  } catch {
    // Never let the scrubber break telemetry. Swallow, return event as-is.
  }
  return event;
}

// Cap recursion depth to keep runaway objects (circular refs slipping
// past Sentry's own handling, absurd nesting) from blowing the stack.
const MAX_DEPTH = 16;

function deepScrub(node: unknown, depth: number): void {
  if (depth > MAX_DEPTH) return;
  if (node === null || node === undefined) return;
  if (typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === "string") {
        node[i] = scrubString(v);
      } else {
        deepScrub(v, depth + 1);
      }
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (PII_KEYS.has(key)) {
      if (typeof v === "string" || typeof v === "number") {
        obj[key] = "[redacted]";
      }
      continue;
    }
    if (typeof v === "string") {
      obj[key] = scrubString(v);
    } else {
      deepScrub(v, depth + 1);
    }
  }
}
