# Renderer policy adoption acceptance

- Status: Historical source/tooling evidence; draft contribution, not merge or release authority
- Owner: Architecture and Desktop maintainers
- Verified: 2026-09-08
- Parent: Issue #79, dependency PR #109
- Base: `990645e5a164e50c8b95f24c6ff0aa7b3e59e1b7`
- Code: `84df15625fce018b2f115bf48934a4b3550a4afa`
- Tested tree: `6847de287019128c6deba4938e3f22ac6b54f5c6`

## Actual change

The existing local AST-policy candidate was adopted without its unrelated UI, lifecycle or locale
changes. Only the application bootstrap exists on this base; nonexistent candidate bootstrap files
were excluded. The 31-file/109-name legacy list was not expanded. Both existing native feature
entrypoints match their real exports. The architecture command now propagates policy failures.

During adoption, a negative test showed that a control HTML module tag could directly load a private
feature file. That bypass is now rejected; the actual CLI mutation fixture covers it alongside new
globals, private imports and public API drift. Removing an old export requires removing its exception.
Comments/strings, local shadowing, UMD parameters, returned/accessor aliases, reflective writes,
destructuring, cycles and unowned sources have focused fixtures.

## Verification

- Mac focused boundary suite: 25 pass. Native Windows 5070 Node 24.20.0: 25 pass and architecture
  CLI PASS. The real-CLI negative fixtures return exit 1 for each injected violation.
- 5070 Linux full Desktop on exact source: 1309 pass / 6 platform skips / 0 fail under umask 022.
- Architecture, exact-tree syntax (483 sources), staged secret scan, install-script and governance
  gates pass without raising budgets or changing required workflow/status names.
- Acorn is pinned to 8.18.0, MIT, dev-only. Its 130 KiB npm archive matched the lockfile's SHA-512
  integrity before transfer. Native hosts used isolated parser caches; original shared dependencies
  were not changed. The lock diff adds only Acorn, with no unrelated upgrades or install scripts.

The first adopted tests exposed missing integration and references to runtime catalog/locale files
not present in this base. They were aligned to the two actual entrypoints and public API drift checks;
no runtime registry or localization migration was fabricated to make them pass. The additional
HTML-bypass regression failed before the new check and passed afterwards.

## Static HTML coverage follow-up (2026-09-08)

- Base: `99cf9ffbf0c2fffc55061b11f5526245b9d490e6`.
- Code: `7bd8e423dd5ac476fc018fb681cfd0202686a116`.
- Tested tree: `a1a9bbdc5c77268be7ec7dd4225b2ba680aa670b`.

The original gate knew only control-page module tags. The new inventory covers all three current
Renderer HTML files and their 41 script declarations, including classic scripts and the two shared
helpers. New nested pages are discovered automatically. Missing/unowned script targets, private
feature tags and inconsistent loading modes are rejected. The syntax gate reads the same grammar
from its exact Git tree, including secondary-page .js module declarations.

The accepted grammar is explicitly restrictive: quoted relative script paths with empty bodies and
only src/type attributes. It does not pretend to implement the browser's complete HTML parser.
Tests cover comments, inline/remote/encoded/query sources, duplicate attributes/loads, incomplete tags,
base overrides and classic/module conflicts. An actual CLI fixture injects a Main helper through the
secondary browser page and a private module through a new nested page; both return exit 1.

- Mac and native Windows combined syntax/HTML/boundary suite: 34 passed each.
- Native Windows architecture CLI: PASS.
- 5070 Linux full Desktop on exact source under umask 022: 1313 pass / 6 platform skips / 0 fail.
- Architecture, exact-tree syntax (485 sources), secrets, install-script and governance gates pass.
- Existing application HTML, Renderer implementation, APIs, packages/dependencies and workflows
  are unchanged by this follow-up. No legacy exception or runtime budget was expanded.

## Overall limits and rollback

No GUI/runtime source changed. UI, installer, native Engine, live-school and signing gates were not
rerun for this dev-only guard; prior parent evidence is not relabeled as a run on this commit.
Static-analysis limitations are explicit in the policy document. This does not complete M1–M5,
Organization migration, independent review or required CI. Renderer AGENTS/policy changes require
Security/Release review; no protections, Actions runs, merges, tags or releases were requested.

Revert the tooling commit to remove the gate and its dev dependency without changing application
data or the parent feature implementations. Parsed strings and fixtures contain no real secrets.
