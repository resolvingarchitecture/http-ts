# http (TypeScript)

A plain (non-anonymized) HTTP/HTTPS client for **1M5**: `Envelope` in,
`Envelope` out — method, URL, and headers come from the envelope, the
response body is written back onto it.

A TypeScript port of [`http-java`](https://github.com/resolvingarchitecture/http-java)'s
`ra.http.HTTPService`, outbound (`sendOut`) side only — see `DESIGN.md`.

## Use

```ts
import { Action, Envelope } from "@resolvingarchitecture/ra-common";
import { HttpClient } from "@resolvingarchitecture/http";

const client = HttpClient.fromConfig({});
const env = Envelope.document();
env.url = "https://resolvingarchitecture.io";
env.action = Action.Get;
if (await client.send(env)) {
  const body = Buffer.from(env.content() as Uint8Array).toString();
}
```

### Config keys

| key | default | meaning |
|-----|---------|---------|
| `ra.http.client.trustAllCerts` | `false` | skip TLS certificate verification (test-only) |
| `ra.http.client.proxyUrl` | unset | HTTP/HTTPS/SOCKS proxy URL, e.g. `http://127.0.0.1:9050` |
| `ra.http.client.requestTimeoutSecs` | `60` | per-request timeout |

## Build

```
npm install
npm test
npm run build
npm run typecheck
```

## Identity metadata leaks

**Fixed 2026-09-26**, the same class of bug found and fixed in
`http-java`/`-cpp`/`-python` and `1m5-remnant`'s Android `TorClient`:
`send()` used to only set a `User-Agent` header when the caller's `Envelope`
already had one; with none, `undici`'s own `fetch` implementation injected
`User-Agent: node` - confirmed directly in
`node_modules/undici/lib/web/fetch/index.js` (`defaultUserAgent`). Now
defaults to a generic, widely-shared browser value instead - verified with
a real test capturing the actual header a local server receives
(`default User-Agent is generic, not undici's own 'node' default`; full
suite: 7 passed). See `DESIGN.md` "Identity metadata leaks" for the
still-open SOCKS5 DNS-resolution check, which does need real verification,
not just assumed from the `ProxyAgent`'s support for a `socks5://` URL.

## Status

Client only — GET/POST/PUT/DELETE, HTTP and HTTPS (via `undici`), multipart
form uploads, a proxy dispatcher. No local HTTP server / SPA / WebSocket
hosting (the Jetty-based half of `http-java`) — see `DESIGN.md` and
`TODO.md`.
