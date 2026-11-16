# ADR 0010: SearchProvider interface (A10)
Status: Accepted
Decision: Serper behind an interface so it can be swapped
Alternatives: see MVP plan section 0.5
Consequences: see MVP plan section 0.5
Reversibility: see MVP plan section 0.5
Review trigger: revisit if scale or team size changes materially

M8-S1 implementation: the worker exposes `SearchProvider` and returns only URL,
title, snippet and position for organic results. Serper credentials stay in the
worker environment. [M8-S2's live check](../serper-credit-verification.md) found
an integer `credits` field in each
successful response. The provider rejects a response without valid per-call
credit usage; M8-S5 must count that value, not an assumed price. A timed-out
call may have been charged before a retry, so the later executor must account
for that uncertainty.
