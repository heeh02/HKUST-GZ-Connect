# Engine NDJSON API v1

`ec-engine` reserves stdout for one UTF-8 JSON object per line. Each line,
including its newline terminator, is at most 1024 bytes and is flushed before
the next lifecycle action. Human-readable diagnostics use stderr only.

The optional `--generation <u64>` argument identifies one desktop connection
attempt. It defaults to `0` for older launchers. Generation is present on every
`state_changed` and final `stopped` event so a delayed event from an old engine
cannot mutate a newer connection.

The mutually exclusive `--socks-auth-optional-stdin` and
`--socks-auth-stdin` flags do not change the event schema. Without either flag,
credential stdin is the gateway username/password pair. With either flag,
stdin contains gateway username, gateway password, local proxy username, and
local proxy password as exactly four lines. No credential value is accepted as
an argument or emitted as an event.

Optional mode accepts both SOCKS5 `NO_AUTH` and RFC 1929, preferring `NO_AUTH`
when the client offers both. UDP ASSOCIATE is retained only for a control
connection that selected `NO_AUTH`; selecting RFC 1929 returns
command-not-supported (`0x07`) for UDP. Strict mode accepts only RFC 1929 and
always returns `0x07` for UDP ASSOCIATE. This per-connection decision prevents
an authenticated control connection from creating a conventional
unauthenticated UDP relay.

Only strict mode enables Basic-authenticated HTTP proxying on the same loopback
listener. HTTPS/WSS use CONNECT. Ordinary absolute-form `http://` and `ws://`
requests are authenticated before method/target validation, rewritten to one
origin-form request, and streamed with bounded headers and body framing. Proxy
credentials, proxy headers, hop-by-hop headers and fields named by
`Connection` never reach the origin. The default and optional contracts reject
HTTP-shaped first packets. These behaviors do not add credential or destination
fields to the NDJSON event schema.

## Events

```json
{"type":"hello","apiVersion":1,"capabilities":["password","l3","udp"]}
{"type":"state_changed","state":"connecting","generation":7}
{"type":"state_changed","state":"authenticating","generation":7}
{"type":"client_ip_assigned","family":4}
{"type":"dns_mode","mode":"gateway"}
{"type":"listener_ready","port":6180}
{"type":"state_changed","state":"connected","generation":7}
{"type":"network_unhealthy","reason":"data_plane_disconnected"}
{"type":"state_changed","state":"stopping","generation":7}
{"type":"fatal_error","code":"NETWORK_DISCONNECTED"}
{"type":"state_changed","state":"stopped","generation":7}
{"type":"stopped","reason":"network_unhealthy","generation":7}
```

Valid state values are `connecting`, `authenticating`, `connected`, `stopping`,
and `stopped`. DNS modes are `gateway`, `system_fallback`, and `disabled`.
Address family is the numeric IP version `4` or `6`; the assigned address is
never included.

Stable fatal codes in v1 are:

- `INVALID_ARGUMENTS`
- `CONFIGURATION_INVALID`
- `CREDENTIALS_INVALID`
- `AUTH_FAILED`
- `UNSUPPORTED_AUTHENTICATION`
- `DATA_PLANE_SETUP_FAILED`
- `LOCAL_LISTENER_FAILED`
- `NETWORK_DISCONNECTED`
- `LOGOUT_FAILED`
- `SHUTDOWN_SIGNAL_FAILED`
- `EVENT_OUTPUT_FAILED`

Final stop reasons are `user_requested`, `startup_failed`,
`local_service_failed`, `network_unhealthy`, `logout_failed`,
`shutdown_failed`, and `event_output_failed`.

## Privacy boundary

Events never contain usernames, passwords, session identifiers, tokens,
assigned IP values, destination addresses, URLs, or free-form error text. The
client address event exposes only its address family. Fatal events expose a
stable code; detailed, redacted diagnostics remain on stderr.

During migration, the four historical readiness messages remain on stderr so
an older desktop parser can still recognize them. They are not part of the
stdout protocol and may be removed after all supported desktop versions consume
API v1.
