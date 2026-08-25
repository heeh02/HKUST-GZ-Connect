# ADR-0031: P8 WebResource library and on-demand Campus boundary

- Status: accepted and implemented on `codex/2.0-p8-web-resources`
- Date: 2026-08-25

## Decision

The ordinary-user resource surface remains Web-only. Packaged reviewed and local custom websites are normalized
to a bounded `WebResource` v1 value. Renderer opens a stored resource by stable ID; Main re-resolves its current
URL and route for the active Profile/Account on every click.

The reviewed resource file is a manifest-bound versioned document. Category and keywords are presentation-only.
The current label is copied into both bounded locale slots until reviewed English text is available; the product
does not invent translations.

Favorites and recent successful opens store only resource IDs and timestamps in separate owner-only files inside
the active Workspace. Missing files mean empty state. Malformed, linked or broadly accessible files fail closed
and are not overwritten by a mutation.

Direct resources open without starting the Campus Engine. One Browser Session retains cookies, POST state and
SSO continuity. Its request boundary resolves every subsequent URL: a Direct request continues immediately; a
Campus redirect is paused while the current Engine generation becomes ready, then the original request resumes
without being replayed as a new GET. Failure cancels the request and never falls back to Direct.

The first P8 implementation intentionally adds no SSH, HPC, TCP, Jupyter, database, file, Remote Desktop,
WebVPN, `LaunchHandle` or generic resource descriptor.

## Consequences

- A compromised or stale Renderer cannot replace the URL/route of a stored resource through the resource-open
  IPC.
- Profile switching invalidates queued opens through the existing active-context transaction barrier.
- The P8 library can present all 32 reviewed plus all 32 local source records; the old 32-item projection remains
  only as a compatibility surface.
- Authenticated server catalogues remain a later evidence-gated provider and cannot silently enter this model.
