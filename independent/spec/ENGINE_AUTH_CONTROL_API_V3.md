# Engine Interactive Auth Control API v3

Status: codec, v2/v3 inherited-pipe multiplexing, synthetic Engine and Desktop
coordinator/UI are implemented. **The current password-only production provider
does not create or advertise an interactive transaction.**

This is the secret-bearing companion to secret-free Control API v2. It exists
so a future reviewed interactive provider can preserve its partial cookie/CSRF/
continuation state inside the Engine while the Desktop sees only sanitized
challenge metadata.

## Transport and framing

- Reuses the Engine's inherited private stdin/stdout pipes; opens no listener.
- One UTF-8 JSON object plus LF per frame.
- Maximum frame size: 8192 bytes including LF.
- Raw input buffers and the decoded response string are zeroizing.
- Parser/diagnostic errors never echo the frame or response.
- `apiVersion` is exactly `3`.
- v2 remains a separate, secret-free schema.

## Sanitized challenge notification

Synthetic example:

```json
{
  "type": "auth_challenge_required",
  "apiVersion": 3,
  "challenge": {
    "transactionId": "04040404040404040404040404040404",
    "challengeEpoch": 1,
    "kind": "otp",
    "deliveryChannel": "unknown",
    "maskedDestination": "masked-fixture",
    "expiresAtUnixMs": 1800000000000,
    "resendAvailable": true,
    "resendAfterUnixMs": 1799999999000,
    "attemptsRemaining": 3
  }
}
```

`transactionId` is an Engine-generated correlation ID, not a server challenge
identifier. Optional metadata may be absent. The schema does not define an OTP
length, character set, vendor method, or network endpoint.

## Commands

Every command binds all four values:

```text
generation + transactionId + challengeEpoch + requestId
```

### Respond

```json
{
  "type": "auth_request",
  "apiVersion": 3,
  "requestId": 10,
  "generation": 42,
  "transactionId": "04040404040404040404040404040404",
  "challengeEpoch": 1,
  "command": {
    "name": "respond",
    "response": "synthetic-response"
  }
}
```

The response is 1–4096 UTF-8 bytes on this JSON wire. That is a memory/wire
bound, not a claim about a real OTP shape. It must not enter settings, a
credential store, logs, telemetry, clipboard, crash reports, or output events.

### Resend

```json
{
  "type": "auth_request",
  "apiVersion": 3,
  "requestId": 11,
  "generation": 42,
  "transactionId": "04040404040404040404040404040404",
  "challengeEpoch": 1,
  "command": { "name": "resend" }
}
```

A successful resend must return a strictly higher `challengeEpoch`. Provider
cooldown/availability remains authoritative, and `AuthTransactionOwner`
independently rejects a command before the provider call while the public
`resendAfterUnixMs` boundary is still in the future.

### Cancel

```json
{
  "type": "auth_request",
  "apiVersion": 3,
  "requestId": 12,
  "generation": 42,
  "transactionId": "04040404040404040404040404040404",
  "challengeEpoch": 1,
  "command": { "name": "cancel" }
}
```

Cancel validates generation, transaction ID, epoch and request ID before it
consumes provider state. Stale or duplicate cancel therefore leaves the valid
transaction active. Once a valid cancel starts, success and cleanup failure are
both terminal; provider state is never restored for another response. Engine-
internal abort performs the same exactly-once cleanup on expiry, control
failure, shutdown, or restart.

`expiresAtUnixMs`, when present, is enforced again by the Engine owner before
respond/resend reaches the provider. Cancel remains available after expiry so
cleanup cannot be blocked by the same deadline. A provider must still enforce
its own server-side expiry; the local check is defense in depth, not a source
of Gateway truth.

## Engine-owned resource budget

The production policy is a client safety ceiling, not a Gateway protocol fact:

- total monotonic transaction lifetime: 4 minutes;
- challenge steps: 10;
- response submissions: 6;
- resends: 4;
- continuation Gateway requests: 32;
- one owner and one current challenge per transaction;
- response and replay bounds remain 4096 bytes and 64 request IDs.

Custom policies may only tighten these ceilings. Submit/resend counters are
reserved before calling the provider. Each provider must reserve a request from
the Engine-issued `AuthGatewayRequestBudget` immediately before continuation
network I/O. Exhaustion is terminal and invokes cleanup. The Engine deadline
timer calls `expire_if_due` even if the Desktop sends no command, so Renderer
countdowns are display-only rather than the security authority.

## Responses

- `auth_challenge`: challenge remains pending or was updated.
- `auth_complete`: authentication produced an authenticated session.
- `auth_cancelled`: transaction cleanup completed.
- `auth_error`: stable code only; never carries the provider message/response.

Stable error codes:

```text
invalid_request
stale_context
duplicate_request
unsupported_challenge
resend_unavailable
challenge_expired
limit_exceeded
provider_failure
transaction_closed
```

Unknown challenges are never respondable or resendable. They may only be
cancelled/aborted, preserving fail-closed behavior.

## Production-provider activation requirements

Infrastructure already completed:

1. ordered zeroizing v2/v3 multiplexing on the inherited private pipe;
2. a Main-owned Desktop challenge coordinator and explicit generic Renderer UI;
3. DOM/Main/Rust response clearing and cross-language synthetic pipe tests;
4. password-only and unknown-method fail-closed regression gates.
5. an in-memory opaque-state fault harness for restart/drop/cancel, provider-
   declared terminal network loss, and L3 setup failure after challenge auth.

Activating a real Gateway interactive provider still requires all of the
following:

1. a reviewed interactive `AuthTransaction` provider backed by sanitized,
   authorized protocol evidence;
2. a synthetic HTTP Gateway/provider adapter covering cookie-jar and
   continuation cleanup, logout failures and transport faults without reusing
   or guessing school endpoints;
3. explicit capability/transaction activation only for that reviewed provider.

This specification does not authorize guessing or implementing a school MFA
endpoint, SMS/email-to-method mapping, verification-code length, or bypass.
