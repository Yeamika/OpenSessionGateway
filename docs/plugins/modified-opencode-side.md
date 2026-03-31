# OSG Modified OpenCode Side

## Why separate this from the plugin side

The OSG plugin side and the modified OpenCode side are related, but they are not the same maintenance surface.

- The **plugin side** is the OSG adapter/integration package.
- The **modified OpenCode side** is the host application or fork behavior that the plugin depends on.

If maintainers collapse those together, they end up describing intended integration shape as if the host runtime behavior were already guaranteed.

## What this side probably includes

Within the wider workspace, `Yaemio/opencode/` is the main OpenCode fork.
When people talk about "the OpenCode side" of OSG in practice, they may mean at least three different things:

1. upstream or forked OpenCode app behavior,
2. local modifications required for OSG-aware runtime/session reporting,
3. plugin wiring that attaches OSG behavior into that OpenCode environment.

This file is about item 1 and item 2, not item 3.

## Maintainer framing

For modified OpenCode behavior, the key question is not just "does the protocol exist?"
It is:

- does the actual OpenCode runtime produce the session/workspace/runtime signals OSG expects,
- does it honor server-originated requests in a meaningful way,
- and are those behaviors native, patched, partial, or only template-level.

## Main risks

### 1. Overstating end-to-end support

A capability can be:

- defined in `protocol-library`,
- routed by the OSG server,
- partially handled by a template,
- but still not fully implemented in the real modified OpenCode runtime.

That is exactly the kind of mismatch maintainers need to keep visible.

### 2. Hiding local fork assumptions

If OSG only works correctly with a customized OpenCode fork, that should be documented as a dependency, not left as tribal knowledge.

### 3. Session/workspace drift

If the modified OpenCode side does not report execution context consistently, the server may show stale or incomplete mappings for:

- current session,
- workspace association,
- display/session relationships,
- current-info style summaries.

### 4. Searchability problems from naming mismatch

Historical misspellings like `AddPromot` and `ClientContentExecuteing` matter here too.
If a maintainer "fixes" the names only in prose, they may make the code harder to trace.

## Suggested documentation habit

When documenting modified OpenCode behavior, use a small status framing like this:

- **protocol-defined**
- **server-routed**
- **observed in modified OpenCode**
- **confidence**

That keeps maintainers from claiming more certainty than the evidence supports.

## Current unresolved question

The biggest unresolved question is still simple:

Which behaviors are truly implemented in the real OpenCode runtime used with OSG, versus merely represented in protocol definitions, template code, or plugin intentions?

Until that is validated directly, docs should keep distinguishing intended design from observed runtime behavior.
