# Current Observations and Risks

## 1. Naming Inconsistency

The codebase currently includes several inconsistent or misspelled identifiers, for example:

- `AddPromot`
- `ClientContentExecuteing`
- `protocol-library`
- README text referring to `sever/`

This creates risk in several areas:

- documentation drift,
- onboarding confusion,
- accidental API mismatches,
- searchability problems.

## 2. Documentation Gaps

Package-level README files exist, but system-level documentation is still thin.
There is not yet a single canonical explanation of:

- the architecture,
- the layering model,
- the runtime/session/workspace relationship,
- the intended responsibility of bridge packages.

## 3. Bridge Default Mapping Behavior

The Feishu bridge currently appears to auto-select a default runtime/session mapping if none is configured.
This is useful for MVP setup, but risky when:

- multiple runtimes are online,
- multiple chats are active,
- users assume deterministic routing.

This behavior needs very explicit documentation.

## 4. Polling-Based Outbound Bridge

The Feishu bridge currently polls OSG for outbound session messages.
Potential implications:

- repeated fetch load,
- delayed delivery,
- duplicate prevention complexity,
- ordering edge cases.

This is not necessarily wrong, but it should be documented as an intentional implementation tradeoff.

## 5. Mixed Gateway Role

The OSG server appears to be both:

- a transport gateway,
- and an in-memory runtime state coordinator.

This is important because maintainers may otherwise assume the server is a thin relay when it is actually storing and interpreting runtime state.

## 6. Early Maintenance Recommendation

Before major refactors, documentation should first stabilize around:

- current terms,
- actual message flow,
- endpoint roles,
- runtime/session ownership boundaries.

That will reduce future breakage caused by unclear assumptions.
