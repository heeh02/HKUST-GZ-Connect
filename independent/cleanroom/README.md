# Clean-room protocol work

The goal is an independently maintained interoperability implementation, not a
runtime wrapper around Sangfor or a third-party client.

The initial modern-protocol implementation used a documented, one-time
provenance review of GPL-licensed interoperability work. That review is listed
in the repository evidence log. The shipped engine contains no downloaded
third-party executable and has no source, build, link, or runtime dependency on
that project. Future changes must be driven by the approved official-client
observers, sanitized fixtures, and the compatibility matrix in this repository.

## Roles

### Analysis team

- Works only in the approved lab.
- May inspect authorized official packages and black-box behavior.
- Produces behavior specifications, field descriptions, state diagrams, and
  synthetic or sanitized test vectors.
- Must not paste decompiled vendor code into specifications or issues.

### Implementation team

- Implements only from reviewed specifications and fixtures.
- Does not paste vendor decompiler output or third-party source into changes.
- Uses the official-client observers and sanitized fixtures for update work.
- Records the specification revision used by each change.

### Validation team

- Runs the official client and independent engine against the same approved
  test gateway and test matrix.
- Handles raw credentials, captures, and tokens as restricted data.

One person may hold multiple roles only after legal/security review determines
that strict separation is unnecessary for the intended internal use.

## Required records

Before dynamic analysis begins, record:

- school authorization owner and date;
- vendor contract/EULA review outcome;
- allowed binaries, gateway environments, accounts, and test period;
- prohibited data and production actions;
- capture retention and deletion policy;
- analyst and implementer identities;
- incident contact and stop conditions.

## Stop conditions

Stop and escalate if testing encounters real-user data, production instability,
rate limits, device-attestation secrets, private keys, or behavior outside the
documented authorization.
