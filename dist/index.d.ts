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
export declare function buildSentryOptions(opts: SentryInitOptions): Record<string, unknown>;
/**
 * Initialize Sentry with the platform-standard options. No-op if
 * `SENTRY_DSN` is absent (common in local dev) so consumers can call
 * this unconditionally at boot.
 */
export declare function initSentry(Sentry: SentryLike, opts: SentryInitOptions): void;
export declare function resolveSampleRate(environment: string): number;
export declare function scrubString(input: string): string;
/**
 * `beforeSend` hook. Mutates the event in place and returns it. Never
 * throws — a throwing beforeSend silently drops every event. Returning
 * `null` would also drop events; we return the (scrubbed) event so the
 * stack trace still reaches Sentry with PII stripped out.
 */
export declare function scrubPiiBeforeSend<T extends object>(event: T): T;
//# sourceMappingURL=index.d.ts.map