# ADR 0007: Fetcher SSRF guards (A7)
Status: Accepted
Decision: SSRF guard, size caps, per-domain rate limiter
Alternatives: see MVP plan section 0.5
Consequences: see MVP plan section 0.5
Reversibility: see MVP plan section 0.5
Review trigger: revisit if scale or team size changes materially

## Connection enforcement (2026-10-25, B1)

Preflight DNS checking alone does not prevent DNS rebinding. The worker now uses
`PublicHTTPTransport` with httpcore's public network-backend interface. Every
new TCP connection resolves and validates all returned addresses, then connects
to an IP literal from that validated set. The original origin remains the pool
key and supplies HTTP Host and TLS SNI/certificate verification. Existing open
connections remain bound to their already validated peer.

Redirects retain URL preflight checks; every new connection, including retries,
is independently guarded. Empty DNS answers fail closed; mixed public/private
answers are refused. Environment proxies are disabled. PoliteFetcher owns its
client so client injection cannot accidentally replace the guarded transport.

`httpcore>=1.0.9,<2` is an explicit dependency (already installed transitively).
The adapter uses public interfaces rather than modifying HTTPX's private pool.
Reference: [httpcore network backends](https://www.encode.io/httpcore/network-backends/).

Socket-boundary tests cover DNS changes before connection and on retry/redirect,
IPv4/IPv6 pinning, Host and verified TLS, shared-IP origin isolation, proxy
environment variables, and stream error/connection cleanup. They mock only the
socket layer and run the real HTTP pool; ordinary respx tests remain in place.
