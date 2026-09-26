/**
 * `HttpClient` - a plain HTTP/HTTPS client. Ports `http-java`'s
 * `ra.http.HTTPService`, outbound (`sendOut`) side only - no Jetty-equivalent
 * local server/SPA/WebSocket hosting (see `DESIGN.md`).
 */
import {
  Action,
  Envelope,
  HEADER_AUTHORIZATION,
  HEADER_CONTENT_DISPOSITION,
  HEADER_CONTENT_TRANSFER_ENCODING,
  HEADER_CONTENT_TYPE,
  SimpleExternalRoute,
} from "@resolvingarchitecture/ra-common";
import { Agent, Headers, ProxyAgent, fetch as undiciFetch, type BodyInit, type Dispatcher } from "undici";

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Sent whenever a caller's `Envelope` has no `User-Agent` header of its own. Without this,
 * `undici`'s `fetch` injects its own default (`"node"` in a Node.js runtime - confirmed
 * directly in `undici`'s own source, `lib/web/fetch/index.js`'s `defaultUserAgent`), which
 * identifies the runtime to every destination rather than blending in. A generic,
 * widely-shared value instead - matches Tor Browser's own practice of giving every user an
 * identical, unremarkable fingerprint. See DESIGN.md "Identity metadata leaks".
 */
export const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";

export type Status = "disconnected" | "connecting" | "connected" | "error";

/** HTTP response codes treated as a sign the request was blocked rather than
 * merely unsuccessful - mirrors `HTTPService.handleFailure` in `http-java`. */
export const BLOCKED_REASONS: Readonly<Record<number, string>> = {
  403: "BLOCKED-FORBIDDEN",
  408: "BLOCKED-TIMEOUT",
  410: "BLOCKED-GONE",
  418: "BLOCKED-TEAPOT",
  451: "BLOCKED-LEGAL",
  511: "BLOCKED-AUTHN",
};

export type HttpClientConfig = Partial<
  Record<"ra.http.client.trustAllCerts" | "ra.http.client.proxyUrl" | "ra.http.client.requestTimeoutSecs", string>
>;

/**
 * A direct (non-anonymized) HTTP/HTTPS client driven by `Envelope`: the URL,
 * method and headers come from the envelope, the response body is written
 * back onto it. For use as the HTTP **protocol service** by a future
 * `1m5-core-ts`, the same role `http-java` plays for `1m5-core-java`.
 */
export class HttpClient {
  requestTimeoutMs: number;
  trustAllCerts: boolean;
  proxyUrl?: string;

  private currentStatus: Status = "disconnected";
  private dispatcher?: Dispatcher;

  constructor() {
    this.requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
    this.trustAllCerts = false;
  }

  /** Config keys: `ra.http.client.trustAllCerts`, `ra.http.client.proxyUrl`,
   * `ra.http.client.requestTimeoutSecs`. */
  static fromConfig(cfg: HttpClientConfig): HttpClient {
    const c = new HttpClient();
    if (cfg["ra.http.client.trustAllCerts"] !== undefined) {
      c.trustAllCerts = cfg["ra.http.client.trustAllCerts"] === "true";
    }
    if (cfg["ra.http.client.proxyUrl"] !== undefined) {
      c.proxyUrl = cfg["ra.http.client.proxyUrl"];
    }
    if (cfg["ra.http.client.requestTimeoutSecs"] !== undefined) {
      c.requestTimeoutMs = Number(cfg["ra.http.client.requestTimeoutSecs"]) * 1000;
    }
    return c;
  }

  status(): Status {
    return this.currentStatus;
  }

  isConnected(): boolean {
    return this.currentStatus === "connected";
  }

  /** Builds the dispatcher (proxy and/or trust-all-certs); never fails. */
  start(): boolean {
    this.currentStatus = "connecting";
    const connectOpts = this.trustAllCerts ? { rejectUnauthorized: false } : undefined;
    this.dispatcher = this.proxyUrl
      ? new ProxyAgent({ uri: this.proxyUrl, connect: connectOpts })
      : connectOpts
        ? new Agent({ connect: connectOpts })
        : undefined;
    this.currentStatus = "connected";
    return true;
  }

  async stop(): Promise<boolean> {
    await this.dispatcher?.close();
    this.dispatcher = undefined;
    this.currentStatus = "disconnected";
    return true;
  }

  /**
   * Send `envelope` out over HTTP(S). The URL comes from `envelope.url`, or
   * failing that a `SimpleExternalRoute` destination's `id` (treated as a
   * host). The method comes from `envelope.action`; headers from
   * `Authorization` / `Content-Type` / `Content-Disposition` /
   * `Content-Transfer-Encoding` / `User-Agent`. On success the response body
   * is written to `envelope.addContent(...)`; on failure
   * `envelope.addErrorMessage(...)`.
   */
  async send(envelope: Envelope): Promise<boolean> {
    if (!this.isConnected() && !this.start()) {
      envelope.addErrorMessage("HTTP Client not connected and unable to connect.");
      return false;
    }

    const route = envelope.getRoute();
    let url = envelope.url;
    if (url === undefined && route instanceof SimpleExternalRoute && route.destination?.id !== undefined) {
      url = `http://${route.destination.id}`;
    }
    if (url === undefined) {
      envelope.addErrorMessage("Must provide either a URL or External Route with destination Network Peer.");
      return false;
    }

    const headers = new Headers();
    for (const name of [
      HEADER_AUTHORIZATION,
      HEADER_CONTENT_DISPOSITION,
      HEADER_CONTENT_TYPE,
      HEADER_CONTENT_TRANSFER_ENCODING,
      "User-Agent",
    ]) {
      const value = envelope.header(name);
      if (typeof value === "string") headers.set(name, value);
    }
    if (!headers.has("User-Agent")) headers.set("User-Agent", DEFAULT_USER_AGENT);

    let body: BodyInit | undefined;
    if (envelope.multipart !== undefined) {
      headers.set(HEADER_CONTENT_TYPE, `multipart/form-data; boundary=${envelope.multipart.boundary}`);
      body = envelope.multipart.finish();
    } else if (route instanceof SimpleExternalRoute && route.sendContentOnly) {
      const content = envelope.content();
      if (typeof content === "string" || content instanceof Uint8Array) {
        body = content;
      } else if (content !== undefined) {
        envelope.addErrorMessage("Only string or byte content supported with sendContentOnly.");
        return false;
      }
    } else {
      body = envelope.toJson();
    }

    const method = actionToMethod(envelope.action);
    if (method === undefined) {
      envelope.addErrorMessage("Envelope.action must be set to Post, Put, Delete, or Get");
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await undiciFetch(url, {
        method,
        headers,
        body: method === "GET" ? undefined : body,
        dispatcher: this.dispatcher,
        signal: controller.signal,
      });
      if (!response.ok) {
        const reason = BLOCKED_REASONS[response.status];
        if (reason !== undefined) {
          console.warn(`HTTP ${response.status} from ${url}: ${reason}`);
        }
        envelope.addErrorMessage(String(response.status));
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      envelope.addContent(bytes);
      return response.ok;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      envelope.addErrorMessage(message);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

function actionToMethod(action: Action | undefined): "GET" | "POST" | "PUT" | "DELETE" | undefined {
  switch (action) {
    case Action.Get:
      return "GET";
    case Action.Post:
      return "POST";
    case Action.Put:
      return "PUT";
    case Action.Delete:
      return "DELETE";
    default:
      return undefined;
  }
}
