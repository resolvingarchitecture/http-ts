# http (TypeScript) — Design

A plain HTTP/HTTPS client for use as the HTTP **protocol service** by a
future `1m5-core-ts`, the same role `http-java`'s `ra.http.HTTPService`
plays for `1m5-core-java` — but client (outbound `sendOut`) only.

## Where it sits

    (future) 1m5-core-ts  ──wraps──►  http_client.HttpClient  ──fetch (undici)──►  origin server

## Client only

`HTTPService` in `http-java` is two things bolted together: an
outbound HTTP/HTTPS client (`sendOut`, `connect`/`disconnect`), and a
Jetty-based local HTTP server used to host `1m5`'s own API / SPA / WebSocket
endpoints (`launch`, `EnvelopeHandler`, `SPAHandler`, `EnvelopeWebSocket`).
`tor-client-java`'s `TORClientService` extends `HTTPService` to get the
client half for free and separately uses the server half to host its hidden
service.

No other language port (`tor-client-{python,rust,cpp,cs,go,ts}`) needed the
server half — each just needs outbound requests. This port keeps to that
same scope: only the client. If a local-server need shows up later (e.g. a
future Tor hidden service in TypeScript), it's a separate addition, not a
retrofit of this class.

## Components

    HttpClient   config, status, start()/stop()/send() — all async

## Message flow

Unlike `tor-client-ts` (whose `TorClient` predates `ra_common.Envelope`
growing a typed `url`/`action`/`content()` surface, and so uses the raw
`headers["url"]`/`headers["body"]`/`headers["error"]` convention), this
client uses that typed surface directly, mirroring `http-java`:

- **URL**: `envelope.url`, or (no URL set) a `SimpleExternalRoute`
  destination `NetworkPeer`'s `id`, treated as `http://<id>`.
- **Method**: `envelope.action` (`Get`/`Post`/`Put`/`Delete`).
- **Headers**: `Authorization`, `Content-Type`, `Content-Disposition`,
  `Content-Transfer-Encoding`, `User-Agent` — copied from
  `envelope.header(...)` if present.
- **Body**: `envelope.multipart` if set (`multipart/form-data`); else, if
  the route is a `SimpleExternalRoute` with `sendContentOnly`,
  `envelope.content()` sent raw (string or bytes); else the whole envelope
  as JSON (`envelope.toJson()`) — same three-way choice as
  `HTTPService.sendOut`.
- **Response**: body bytes written to `envelope.addContent(...)`; a non-2xx
  status is recorded via `envelope.addErrorMessage(String(status))`, and a
  status in `{403, 408, 410, 418, 451, 511}` is additionally logged as a
  likely-blocked signal (`BLOCKED_REASONS`) — mirrors
  `HTTPService.handleFailure`, without inventing a `NetworkConnectionReport`
  type in `ra-common-ts` (none exists yet; out of scope for this repo).

## HTTP client library

Uses [`undici`](https://undici.nodejs.org/) directly (not the global
`fetch`) so a custom `Dispatcher` can be supplied per-client: a `ProxyAgent`
when `ra.http.client.proxyUrl` is set, or a plain `Agent` with
`rejectUnauthorized: false` when `ra.http.client.trustAllCerts` is set (both,
or neither). Node's global `fetch` is undici under the hood but doesn't
expose a way to swap its dispatcher without `setGlobalDispatcher` — global,
process-wide state this library doesn't want to touch.

## Status model

`Status` is its own 4-state type (`"disconnected" | "connecting" |
"connected" | "error"`), not `ra_common`'s wider `NetworkStatus` — matches
`tor-client-ts` / `i2p-ts`. `start()` builds the dispatcher (never fails, so
always ends `"connected"`); `stop()` closes it and returns to
`"disconnected"`.

## Identity metadata leaks

Required standard for any HTTP client this project relies on for anonymized
traffic (Tor/I2P), enforced here and checked against every sibling
`http-*` port: no default header, response header, or connection
behavior may reveal more about the requester than it has to.

- **Fixed 2026-09-26**: `send()` used to only set `User-Agent` when the
  caller's `envelope.header("User-Agent")` was already present; with none,
  `undici`'s `fetch` injected its own default. Confirmed directly in this
  project's installed copy (`node_modules/undici/lib/web/fetch/index.js`):
  ```
  const defaultUserAgent = typeof __UNDICI_IS_NODE__ !== 'undefined' ...
    ? 'node' : 'undici'
  ...
  if (!httpRequest.headersList.contains('user-agent', true)) {
    httpRequest.headersList.append('user-agent', defaultUserAgent, true)
  }
  ```
  Now `DEFAULT_USER_AGENT` (a generic, widely-shared browser value) is set
  on the `Headers` object whenever the caller hasn't supplied one - same
  fix already applied to `http-java` (OkHttp's own default,
  confirmed via bytecode), `http-cpp`/`http-python` (both
  previously defaulted to the project-identifying literal
  `"ra-http"`, arguably worse), `http-go`/`http-rust`,
  and `1m5-remnant`'s Android `TorClient`. Verified with a real test
  (`default User-Agent is generic, not undici's own 'node' default`) that
  captures the actual header a local server receives, not just that the
  code compiles - full suite: 7 passed.
- **Not yet verified**: does undici's `ProxyAgent` speak genuine SOCKS5 for a
  `socks5://` `proxyUrl`, or only HTTP CONNECT-style tunneling? Not checked
  in this pass. If it's CONNECT-only, this client cannot correctly reach a
  SOCKS5-only relay like `tor-client-java`'s `TorSocksRelay` at all - a
  functional gap, not just a leak - and if it does support SOCKS5, confirm
  it resolves the destination hostname via the proxy, not local DNS, the
  same requirement `http-cpp`'s `ConnectThroughSocks5` was directly
  confirmed to meet. A local resolution would leak the destination outside
  the proxy entirely, the same bug found and fixed in
  `bitcoin-client-java`'s bitcoinj DNS-seed lookups (`tor-client-java`,
  2026-09-25).
- **No server/inbound half** (see "Client only" above), so the third known
  leak shape - a server-identifying response header, found and fixed in
  `http-java`'s Jetty listener (`Server: Jetty(<version>)`) - doesn't
  apply yet. Check for it if local server hosting is ever built.

## Not here

- Local HTTP server / SPA hosting / WebSocket — `http-java`'s Jetty
  half (`EnvelopeHandler`, `SPAHandler`, `EnvelopeWebSocket`,
  `EnvelopeJSONDataHandler`, `EnvelopeProxyDataHandler`). No other port has
  this either.
- A `NetworkConnectionReport`-equivalent type — `ra-common-ts` doesn't have
  one; blocked responses are logged and recorded as an envelope error
  message only.
- Redirect following configuration parity with `http-java`'s three
  separate `OkHttpClient`s (plain HTTP / compatible HTTPS / strong HTTPS) —
  `undici`'s single client handles HTTP and HTTPS uniformly; there's no
  equivalent three-way TLS strictness split.
