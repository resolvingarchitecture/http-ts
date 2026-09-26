# Changelog

## 0.1.0

- Initial TypeScript port of `http-java`'s `ra.http.HTTPService`,
  client (outbound `sendOut`) only: GET/POST/PUT/DELETE, HTTP and HTTPS via
  `undici`, multipart form uploads, optional proxy dispatcher and
  trust-all-certs (test-only). No local server/SPA/WebSocket hosting.
