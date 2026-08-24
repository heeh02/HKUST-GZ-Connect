# ADR-0005: External Tool Integration Center

- Status: Accepted product/architecture direction for the first 2.0 Beta
- Decision owner: project maintainer
- Production activation: requires the P8 integration gates below

## Context

Campus Connect already exposes an authenticated loopback SOCKS/HTTP frontend, a PAC file, Clash-compatible
YAML and an OpenSSH `ProxyCommand` helper. These are useful integration surfaces, but they are not campus
resources and they do not justify resource-scoped SSH, HPC, database, Jupyter or forwarding launchers.

The first 2.0 Beta narrows the Resource Workspace to reviewed and local Web resources. Advanced users still need
a clear way to configure tools such as Clash, Mihomo, Clash Verge Rev, OpenSSH and VS Code without weakening
local proxy authentication or silently reusing one school's tunnel after a profile/account switch.

## Decision

Introduce an **External Tool Integration Center** as a domain independent from the resource catalogue and
`ResourceLaunchBroker`.

The first Beta supports explicit preview plus export or managed install/update/remove for:

- generic Clash-compatible YAML export, with separately tested labels for Clash and Mihomo;
- a Clash Verge Rev managed extension with install, update and remove lifecycle;
- OpenSSH through a one-time managed `Include` plus profile-scoped configuration using the packaged
  `ProxyCommand` helper;
- VS Code Remote-SSH guidance/configuration that reuses the managed OpenSSH boundary;
- PAC URL/file export with an explicit client-authentication compatibility explanation;
- a bounded manual endpoint/configuration export for other reviewed clients.

The Center does not:

- model SSH, HPC, Jupyter, database or forwarding targets as `ResourceDescriptor` values;
- create or consume `resourceHandle`, `LaunchHandle` or `ForwardLease` values;
- install VS Code extensions, open a terminal, launch an arbitrary executable or open a workspace;
- scan local processes or search broadly for third-party configuration files;
- scan disks or silently choose/overwrite third-party configuration, subscriptions or user-owned blocks;
- weaken strict local proxy authentication to make an adapter appear compatible;
- claim that a generic copied/exported configuration was imported or connected; a managed adapter reports
  installed only after its exact target passes parse/readback validation.

## Domain model

Adapter selection is closed and compiled:

```text
IntegrationAdapterId
  clash_yaml
  mihomo_yaml
  clash_verge_rev_managed
  openssh_proxy_command
  vscode_remote_ssh
  pac
  manual_export
  user_selected_managed_block

IntegrationAdapterView
  integrationHandle          opaque, non-authorizing
  adapterId
  displayName
  supportedActions[]         preview | copy | save | install | update | remove
  compatibilityState
  bindingState               current | stale | unavailable
  updatedAt?
```

Renderer views contain no proxy username/password, generated YAML, helper credential path, persistent
profile/account/workspace key, full third-party path or command line. A value-free trusted IPC asks Main to
prepare an action for an opaque current `integrationHandle`; a separate explicit confirmation consumes the
prepared diff/transaction.

Main owns the complete binding:

```text
IntegrationBindingInternal
  schemaVersion
  adapterId / adapterVersion
  profileId / profileRevision / profileCredentialBindingRevision
  accountKey / accountRevision / accountCredentialRevision
  workspaceKey / activeContextEpoch
  listenerKind / loopbackHost / loopbackPort
  proxySecurityRevision / credentialRef
  routingPolicyRevision / pacRevision
  engineGeneration?
  recordRevision
  state
```

Persistent keys, `credentialRef` and secret output material never cross to Renderer. Non-secret integration
records belong to the account workspace. Proxy credentials remain in the secure credential domain; an
integration record contains only a reference and revision.

## Profile and account binding

External configurations outlive the UI action that created them, so a display label is not a security binding.
Every integration must bind to the exact profile/account and local-proxy security revision used to generate it.

On profile/account switch, credential reset, listener port change, proxy-auth change or incompatible PAC/routing
revision:

1. close or invalidate the old integration generation;
2. revoke/rotate the profile-account proxy credential and helper sidecar;
3. mark retained non-secret integration records stale;
4. activate the new profile/account listener only after its binding is committed;
5. require an explicit regenerate/export/update action for stale external configuration.

An old Clash/OpenSSH configuration must fail authentication after switching to another profile/account. It must
never silently borrow the newly active school's tunnel merely because the loopback port was reused.

Profile-bound integration therefore requires strict local proxy authentication. Existing `NO_AUTH`
compatibility may remain as a clearly labelled legacy, unbound mode for 1.x compatibility, but it cannot satisfy
the multi-school Integration Center contract and is not silently selected by an adapter.

PAC cannot embed a safe reusable proxy credential. The Center must report whether the selected external client
can complete the required proxy authentication. It never turns strict authentication off automatically.

## Transactional preview and managed lifecycle

Each action follows one Main-owned transaction:

```text
validate trusted sender + exact value-free action
  -> snapshot active profile/account/context/listener/policy revisions
  -> resolve the closed adapter
  -> validate adapter/platform/auth compatibility
  -> resolve only the documented adapter target or one user-selected target
  -> prepare secret and non-secret output plus a bounded redacted diff in Main memory
  -> return only the redacted preview/status
  -> on explicit confirmation, copy/export or stage install/update/remove
  -> create a bounded owner-only backup when an existing file changes
  -> atomically replace and parse/read back the staged output
  -> atomically commit the non-secret IntegrationRecord
  -> revoke temporary material and remove rollback state
```

If any bound revision or target digest changes before commit, the transaction fails stale. File export and
managed lifecycle use a bounded same-directory temporary file, owner-only permissions/ACL, fsync and atomic
rename where the selected filesystem supports it. An existing target receives a bounded owner-only backup before
replacement. The adapter parses/validates the committed result and restores the exact backup on failure. A
partial action is removed or reported as rollback-incomplete; it is never recorded as current.

Clipboard output is an explicit secret-bearing action performed by Main. Optional timed clearing may occur only
when the clipboard still exactly contains the payload written by this transaction, so newer user clipboard data
is never erased.

The first Beta writes only one of these scoped targets:

1. a user-selected generic export;
2. the dedicated Campus Connect managed extension owned by the Clash Verge Rev adapter;
3. one managed OpenSSH `Include` block and app-owned profile configuration;
4. an exact user-selected third-party file where a reviewed adapter owns one marked managed block.

No adapter performs a full-disk search, rewrites a subscription, replaces an unmarked user block or edits an
unselected target. Every managed adapter has its own parser, conflict policy, ownership marker, diff, backup,
readback and uninstall tests.

## Adapter boundaries

### Clash and Mihomo generic export

These adapters may share a reviewed Clash-compatible YAML generator, but compatibility is tested and reported
per tool. The first Beta offers copy/save export; it does not find or overwrite a Clash/Mihomo subscription or
configuration automatically. YAML contains only the loopback endpoint and the exact profile-bound proxy
credential required by the active listener. No Browser routing rule silently changes these integrations to
Direct.

### Clash Verge Rev managed extension

The adapter owns a dedicated Campus Connect extension/provider fragment under a documented Clash Verge Rev
integration point. Install creates only that owned fragment/reference; update changes only the same recorded
object; remove deletes only the exact object whose ownership marker and digest match the IntegrationRecord. It
never overwrites subscriptions, mode/rule groups or unrelated user configuration. Every action shows a redacted
diff, creates a backup where an existing file changes, atomically applies, parses/reads back and rolls back on
failure.

### OpenSSH and VS Code

OpenSSH install uses the packaged `ec-proxy-command` and an owner-only, profile/account-bound credential sidecar.
After an explicit preview, it adds one idempotent managed `Include` to the user-selected OpenSSH config and owns
profile-scoped config below an app-owned directory. Update changes only the owned profile file; remove deletes the
owned profile file and removes the Include only when no managed profile still needs it. Existing Host blocks are
never rewritten.

The OpenSSH `Port` directive always means the **remote SSH service port** (normally 22 or an explicitly
user-selected remote port). It is never set to the local SOCKS/HTTP listener port. Campus proxying is expressed
only through the packaged `ProxyCommand ... -- %h %p`, whose helper reads the profile/account-bound sidecar. The
adapter does not derive a host or port from an HPC/resource record and does not execute SSH.

VS Code Remote-SSH guidance reuses that OpenSSH fragment. The Center neither installs the Remote-SSH extension
nor edits a workspace or launches VS Code in the first Beta.

### PAC

PAC export is revisioned and bound to the active profile/account policy. Its `DIRECT` behavior retains the
documented 1.x external-PAC risk boundary and does not claim `ControlledDirectExit` protection. Authentication
limitations are shown before export.

### User-selected managed blocks and manual export

Manual export provides a bounded protocol/endpoint/authentication description or a user-selected configuration
file. Secret fields remain Main-owned until the explicit copy/save action. Renderer and diagnostics receive only
redacted presence/status fields.

For another reviewed client, install/update/remove is available only after the user selects the exact target
file. The adapter owns one uniquely marked block and records the precondition digest. It refuses an unknown
format, marker collision, concurrent edit or request to replace unrelated content. Removal deletes only the
matching owned block and preserves every other byte/semantic record.

## Failure model

Integration errors are separate from resource-launch errors:

```text
INTEGRATION_ADAPTER_UNAVAILABLE
INTEGRATION_PROFILE_STALE
INTEGRATION_ACCOUNT_STALE
INTEGRATION_LISTENER_UNAVAILABLE
INTEGRATION_AUTH_INCOMPATIBLE
INTEGRATION_CREDENTIAL_UNAVAILABLE
INTEGRATION_POLICY_STALE
INTEGRATION_EXPORT_CONFLICT
INTEGRATION_EXPORT_FAILED
INTEGRATION_TARGET_CHANGED
INTEGRATION_INSTALL_FAILED
INTEGRATION_UPDATE_FAILED
INTEGRATION_REMOVE_FAILED
INTEGRATION_ROLLBACK_INCOMPLETE
```

Errors do not contain generated configuration, credential values, full third-party paths or arbitrary command
lines. A failed/stale integration never changes Campus/Direct policy or starts another Engine.

## P8 acceptance

The Integration Center portion of P8 is complete only when:

- every listed adapter has bounded schema and golden configuration tests on its supported platforms;
- Profile A credentials are rejected after switching to Profile/Account B;
- port, proxy-auth, credential and PAC revision changes make old bindings stale;
- 100 profile/account switch cycles leave zero listener, helper-sidecar, credential or transaction residue;
- install/update/remove/export write/fsync/rename/readback and rollback fault injection is all-old/all-new or
  explicitly fail-closed;
- owner-only POSIX modes and Windows ACLs are package-tested;
- Renderer, argv, logs, telemetry and crash output contain zero generated secret payloads;
- Browser domain rules never silently route Clash/Mihomo/OpenSSH/VS Code integrations Direct;
- Clash Verge Rev install/update/remove changes only its owned extension and never a subscription;
- OpenSSH install is one idempotent managed Include plus profile config; its `Port` remains the remote port and
  Campus access uses only `ProxyCommand`;
- other managed adapters require an explicit user-selected target and change only their owned block;
- no adapter scans disks/processes, overwrites unrelated third-party content or mutates global DNS/routes/proxy;
- package verification includes the production adapters but excludes synthetic tool/config fixtures.

P8 can ship only after both the Web Resource Workspace gates and these Integration Center gates pass. Neither
domain implies SSH/HPC/Jupyter/database launch or scoped forwarding support.

## Multi-school rollout

The first user-visible Beta remains HKUST(GZ)-only. The architecture remains multi-school: P10 adds the second
reviewed profile and must repeat the integration credential-rotation, stale-export and zero-cross-profile tests
with two real reviewed profiles. P11 custom Gateway onboarding remains separately gated and receives no inherited
integration record or proxy credential.

## Rollback

Disabling the Integration Center removes its UI/IPC adapters and retires app-owned integration metadata without
changing VPN credentials, Browser state or user-owned exported files. Previously exported configuration is not
silently deleted; its profile-bound credential is revoked so it cannot authorize another active profile.
