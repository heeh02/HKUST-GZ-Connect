# ADR-0032: Repository-ID-bound update discovery

- Status: Accepted for the 2.0.1 ownership-transfer bridge
- Owner: Security and Release maintainers
- Last verified: 2026-09-04
- Applies to: `desktop/lib/platform/update/update-check.js`
- Parent procedure: [`../governance/repository-transfer-playbook.md`](../governance/repository-transfer-playbook.md)

## Context

The 2.0.0 client discovers updates through a GitHub API URL containing the personal repository
owner. GitHub preserves a repository's numeric ID across an ownership transfer, but the canonical
owner/name URL changes. Node's basic HTTPS request does not make an old-owner redirect a durable
trust or availability contract. Transferring before a bridge release could therefore strand the
installed 2.0.0 update channel.

Following arbitrary redirects or accepting any repository returned by GitHub would solve
availability by weakening the release trust boundary. The client must discover the new owner while
remaining bound to the same public repository.

## Decision

Update discovery has exactly two network stages:

```text
GET https://api.github.com/repositories/1279507615
  -> validate immutable ID, fixed name, owner login, full name,
     public/enabled/unarchived state, canonical API/Web URLs and Release template
  -> construct the current repository's latest/list Release endpoints
  -> fetch the applicable Release document
  -> accept only a page beneath that exact canonical Release prefix
```

The production trust root contains the immutable numeric repository ID and the non-renamed
repository name. It contains no default personal-owner Release endpoint. The owner returned by the
ID lookup is data only after the complete metadata tuple matches; it is not accepted from a
redirect, Release document or renderer input.

Every timeout, non-200 response, malformed body, identity mismatch, private/archived/disabled
repository, invalid version or off-prefix Release URL returns the existing unavailable result. The
application continues to notify and open a page only; it does not download, install or execute an
update.

## Consequences

- A transfer with unchanged repository ID and name keeps update discovery working.
- Renaming, replacing, privatizing, archiving or disabling the repository intentionally disables
  update notices until maintainers make another reviewed trust decision.
- The bridge release must be published before transfer; a client with the old owner-bound code
  cannot benefit from this decision after it loses its endpoint.
- Repository links in documentation may be updated after transfer, but production update trust must
  remain ID-bound.

## Verification

Unit tests cover the current owner, a synthetic Organization owner, every identity field mismatch,
off-prefix pages, stable/prerelease ordering, network failure and the absence of an owner-based
default. Release verification must additionally query the live numeric-ID endpoint from the exact
tagged build before transfer and again after transfer.
