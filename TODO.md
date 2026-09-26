# TODO

- [x] **Identity metadata leak, fixed 2026-09-26**: no default `User-Agent`
      was set, so `undici`'s `fetch` injected its own `'node'` default
      (confirmed directly in `node_modules/undici/lib/web/fetch/index.js`) -
      see DESIGN.md "Identity metadata leaks". Now sends
      `DEFAULT_USER_AGENT` (generic) when the caller hasn't supplied one;
      verified with a real test capturing the actual header a local server
      receives (7/7 tests pass).
- [ ] **Verify, don't assume**: confirm whether `undici`'s `ProxyAgent`
      speaks genuine SOCKS5 (required to reach `TorSocksRelay` at all) or
      only HTTP CONNECT, and if SOCKS5, that it resolves the destination
      hostname via the proxy, not local DNS - see DESIGN.md "Identity
      metadata leaks".
- [ ] Local HTTP server / SPA / WebSocket hosting (the Jetty half of
      `http-java`), if a TypeScript consumer ever needs to host
      inbound endpoints (e.g. a future onion service).
- [ ] `NetworkConnectionReport`-equivalent type in `ra-common-ts`, if
      `1m5-core-ts`'s router ends up wanting structured blocked-response
      data rather than a logged warning + error message.
- [ ] Streamed request/response bodies (large file upload/download) —
      currently buffers the whole response into memory
      (`response.arrayBuffer()`).
- [ ] `1m5-core-ts` doesn't exist yet — no `HttpProtocolService` wiring
      possible until it does (see `1m5-core-java`'s
      `network.onemfive.core.protocol.HttpProtocolService` /
      `1m5-core-rust`'s `protocol.rs` for the pattern to mirror).
