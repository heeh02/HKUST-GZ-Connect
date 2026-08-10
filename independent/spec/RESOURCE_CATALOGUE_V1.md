# Resource catalogue presentation API v1

`resource_catalogue.rs` parses an already acquired EasyConnect resource XML
document into two deliberately separate views:

1. `SanitizedResourceCatalogue` is the versioned presentation API for a local
   trusted UI.
2. `ResourceLaunchTarget` contains exact launch material and is available only
   by resolving an opaque resource handle inside the owning Rust catalogue.

This split prevents routine serialization, diagnostics and debug formatting
from copying an internal host, URL path, query, fragment, vendor identifier,
service value or raw authorization value. Exact targets are not `Serialize` or
`Display`, and every relevant `Debug` implementation is redacted. The aggregate
`safe_summary()` additionally omits labels, handles, target-shape details and
port ranges, so it is the only catalogue output permitted in logs or probes.

## Evidence boundary

The reviewed Linux binary baseline marks the resource endpoint in `ECAgent`,
and the authorized redacted gateway baseline records `RcGroups/Group` plus
`Rcs/Rc` attributes for identifiers, names, type/protocol, host/port/service,
group references and `authorization`. The baseline intentionally contains only
field names and structure, not response values. It therefore supports the
parser shape but cannot support a value-to-policy mapping, refresh contract or
authenticated-fetch implementation. No new official binary, live credential or
gateway request is required by this module or its tests.

## Presentation schema

The JSON representation has `schema_version: 1` and these top-level fields:

| Field | Meaning |
| --- | --- |
| `groups` | Opaque group handle, presentation-only label and resource count |
| `resources` | Opaque handle, presentation-only label, optional group handle, normalized kind/protocol, authorization signal and redacted target shape |
| `default_resource_handle` | Opaque handle only when the server reference resolves |
| `dns_policy_present` | Whether the document contains a DNS-policy element; never its contents |
| `authorization_decisions_available` | Always `false` until a reviewed gateway-specific policy adapter exists |

The target shape reports only whether a target is absent, a bare host or an
absolute URL; host address family; whether an explicit port/path/query/fragment
exists; and the bounded port policy. It never contains the corresponding value.

Labels are the only server-provided text in the presentation API because the
directory cannot be useful without its names. They are local-UI-only data and
must not be copied into logs, telemetry or diagnostic bundles. Their length and
control characters are validated, and their `Debug` output is redacted.

## Authorization semantics

The observed gateway schema contains an `authorization` attribute, but the
reviewed baseline contains no value semantics. V1 therefore exposes exactly:

- `not_declared` for a missing or blank attribute;
- `declared_unverified` for any bounded non-blank attribute.

It never reports allowed or denied. Every resource also has
`authorization_decision_available: false`. A caller must fail closed when an
authorization decision is required and must not infer permission from the
presence, spelling or apparent truthiness of the vendor value.

## Parser guarantees

The parser is offline and performs no request. It enforces the shared XML byte
limit plus explicit element, depth, group, resource, identifier, label, target,
service and authorization bounds. Duplicate identifiers, handle collisions,
unresolved group/default references, URL user information, unsupported URL
schemes, invalid port policies and ambiguous bare targets are errors. Error
messages describe only the failed field class and never echo source values.

`OfflineResourceDocumentProvider` owns a zeroizing copy of its input and
advertises catalogue parsing as `Supported`, but authorization decisions as
`Unavailable`. `UnsupportedResourceProvider` remains the production provider:
authenticated retrieval, cookie/session lifetime, refresh, expiry, policy
interpretation and launch behavior still require an approved canary. The
offline provider must never be wired in as proof that those capabilities work.
