use std::sync::atomic::{AtomicU32, Ordering};

pub struct HistoryIdCounter(AtomicU32);

impl HistoryIdCounter {
    pub fn new() -> Self {
        Self(AtomicU32::new(0))
    }

    pub fn next(&self) -> u32 {
        self.0.fetch_add(1, Ordering::SeqCst)
    }

    pub fn set_next(&self, value: u32) {
        self.0.store(value, Ordering::SeqCst);
    }
}

/// Builds a byte-exact HTTP/1.1 response carrying a styled, animated HTML
/// error page for upstream failures (DNS resolution, TCP connect, TLS
/// handshake, or a request that failed after a connection was already
/// established). Sent to the *client* leg so the failure is visible in the
/// browser instead of just being logged and silently dropping the
/// connection. `Connection: close` is intentional -- we always break the
/// loop right after sending this, so we don't want the client retrying the
/// request on what it thinks is still a live keep-alive connection.
pub fn build_error_response(target: &str, error: &impl std::fmt::Display) -> Vec<u8> {
    // Plain substitution, NOT run through `format!` -- the template is full
    // of CSS/JS braces, and templating the whole page would mean escaping
    // every `{`/`}` in the stylesheet and script. Two unique placeholder
    // tokens avoid that entirely.
    let html = ERROR_PAGE_TEMPLATE
        .replace("__TARGET__", &html_escape(target))
        // JSON-encode the error text so it drops in as a *safe* JS string
        // literal inside the <script> block -- handles quotes, backslashes,
        // and newlines correctly instead of hand-rolled escaping.
        .replace(
            "__ERROR_JSON__",
            &serde_json::to_string(&error.to_string()).unwrap_or_else(|_| "\"\"".to_string()),
        );

    let mut resp = format!(
        "HTTP/1.1 502 Bad Gateway\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n",
        html.as_bytes().len()
    )
    .into_bytes();
    resp.extend_from_slice(html.as_bytes());
    resp
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

const ERROR_PAGE_TEMPLATE: &str = r##"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Aresius - Connection Failed</title>
<style>
  :root {
    --bg: #0e0e13;
    --panel: #1c1c24;
    --border: #2a2a35;
    --accent: #8b5cf6;
    --error: #ff5c5c;
    --text: #e4e4e9;
    --text-dim: #8b8b9a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 50% 30%, #1a1a24 0%, #0b0b0f 100%);
    font-family: 'Segoe UI', -apple-system, sans-serif;
    color: var(--text);
  }
  .card {
    width: 480px;
    max-width: 90vw;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 40px 36px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    opacity: 0;
    animation: cardIn 0.5s ease-out 0.1s forwards;
  }
  @keyframes cardIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .logo-wrap {
    width: 72px;
    height: 72px;
    margin: 0 auto 20px;
    opacity: 0;
    transform: scale(0.2);
    animation: logoPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s forwards;
  }
  @keyframes logoPop {
    0%   { opacity: 0; transform: scale(0.2) rotate(-15deg); }
    60%  { opacity: 1; transform: scale(1.12) rotate(4deg); }
    100% { opacity: 1; transform: scale(1) rotate(0deg); }
  }
  .logo-wrap svg { width: 100%; height: 100%; display: block; }
  .status-pill {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--error);
    background: rgba(255, 92, 92, 0.12);
    border: 1px solid rgba(255, 92, 92, 0.3);
    padding: 3px 10px;
    border-radius: 20px;
    margin-bottom: 16px;
    opacity: 0;
    animation: fadeUp 0.4s ease-out 0.4s forwards;
  }
  h1 {
    font-size: 17px;
    font-weight: 600;
    margin: 0 0 6px;
    opacity: 0;
    animation: fadeUp 0.4s ease-out 0.55s forwards;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .target {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 13px;
    color: var(--text-dim);
    margin: 0 0 18px;
    opacity: 0;
    animation: fadeUp 0.4s ease-out 0.7s forwards;
  }
  .target code {
    color: var(--accent);
    background: rgba(139, 92, 246, 0.1);
    padding: 2px 8px;
    border-radius: 5px;
  }
  .detail-box {
    text-align: left;
    background: #0e0e13;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 12.5px;
    line-height: 1.6;
    color: #d0d0dc;
    min-height: 20px;
    opacity: 0;
    animation: fadeUp 0.4s ease-out 0.9s forwards;
  }
  .cursor {
    display: inline-block;
    width: 7px;
    height: 14px;
    background: var(--accent);
    margin-left: 2px;
    vertical-align: middle;
    animation: blink 0.9s step-end infinite;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  .hint {
    margin-top: 20px;
    font-size: 11px;
    color: var(--text-dim);
    opacity: 0;
    animation: fadeUp 0.4s ease-out 1.1s forwards;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="logo-wrap">
      <!-- Aresius logo placeholder -- swap with the real inline SVG or a
           data:image/png;base64,... URI when available. Must stay
           self-contained: this page is served as a raw HTTP response, not
           through the Tauri webview, so it has no access to bundled assets. -->
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#a78bfa"/>
            <stop offset="1" stop-color="#6d28d9"/>
          </linearGradient>
        </defs>
        <path d="M32 3 L59 15 V32 C59 47 47 58 32 62 C17 58 5 47 5 32 V15 Z" fill="url(#g)" opacity="0.15"/>
        <path d="M32 3 L59 15 V32 C59 47 47 58 32 62 C17 58 5 47 5 32 V15 Z" stroke="url(#g)" stroke-width="2"/>
        <path d="M32 18 L44 44 H37 L34.5 38 H29.5 L27 44 H20 L32 18 Z M32 27 L29.5 33 H34.5 L32 27 Z" fill="url(#g)"/>
      </svg>
    </div>
    <div class="status-pill">CONNECTION FAILED</div>
    <h1>Aresius could not reach the target</h1>
    <p class="target">Request to <code>__TARGET__</code></p>
    <div class="detail-box"><span id="typed"></span><span class="cursor"></span></div>
    <p class="hint">Check the host is reachable and DNS resolves, then retry.</p>
  </div>
  <script>
    (function () {
      var text = __ERROR_JSON__;
      var el = document.getElementById('typed');
      var i = 0;
      function tick() {
        if (i <= text.length) {
          el.textContent = text.slice(0, i);
          i++;
          setTimeout(tick, 14);
        }
      }
      setTimeout(tick, 950);
    })();
  </script>
</body>
</html>"##;

/// Builds a styled, animated HTML response for requests or responses dropped
/// by the user in the Interceptor.
pub fn build_dropped_response(target: &str, is_request: bool) -> Vec<u8> {
    let item_type = if is_request { "Request" } else { "Response" };
    let detail_msg = if is_request {
        "The HTTP request was intercepted and dropped by the user in Aresius Interceptor before reaching the target server."
    } else {
        "The HTTP response was intercepted and dropped by the user in Aresius Interceptor before reaching the browser."
    };

    let html = DROPPED_PAGE_TEMPLATE
        .replace("__TARGET__", &html_escape(target))
        .replace("__ITEM_TYPE__", item_type)
        .replace(
            "__DETAIL_JSON__",
            &serde_json::to_string(detail_msg).unwrap_or_else(|_| "\"\"".to_string()),
        );

    let mut resp = format!(
        "HTTP/1.1 403 Forbidden\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n",
        html.as_bytes().len()
    )
    .into_bytes();
    resp.extend_from_slice(html.as_bytes());
    resp
}

const DROPPED_PAGE_TEMPLATE: &str = r##"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Aresius - __ITEM_TYPE__ Dropped</title>
<style>
  :root {
    --bg: #0e0e13;
    --panel: #1c1c24;
    --border: #2a2a35;
    --accent: #f59e0b;
    --warn: #f59e0b;
    --text: #e4e4e9;
    --text-dim: #8b8b9a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 50% 30%, #1f1b18 0%, #0b0b0f 100%);
    font-family: 'Segoe UI', -apple-system, sans-serif;
    color: var(--text);
  }
  .card {
    width: 480px;
    max-width: 90vw;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 40px 36px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    opacity: 0;
    animation: cardIn 0.5s ease-out 0.1s forwards;
  }
  @keyframes cardIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .logo-wrap {
    width: 72px;
    height: 72px;
    margin: 0 auto 20px;
    opacity: 0;
    transform: scale(0.2);
    animation: logoPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s forwards;
  }
  @keyframes logoPop {
    0%   { opacity: 0; transform: scale(0.2) rotate(-15deg); }
    60%  { opacity: 1; transform: scale(1.12) rotate(4deg); }
    100% { opacity: 1; transform: scale(1) rotate(0deg); }
  }
  .logo-wrap svg { width: 100%; height: 100%; display: block; }
  .status-pill {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--warn);
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.3);
    padding: 3px 10px;
    border-radius: 20px;
    margin-bottom: 16px;
    opacity: 0;
    animation: fadeUp 0.4s ease-out 0.4s forwards;
  }
  h1 {
    font-size: 17px;
    font-weight: 600;
    margin: 0 0 6px;
    opacity: 0;
    animation: fadeUp 0.4s ease-out 0.55s forwards;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .target {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 13px;
    color: var(--text-dim);
    margin: 0 0 18px;
    opacity: 0;
    animation: fadeUp 0.4s ease-out 0.7s forwards;
  }
  .target code {
    color: var(--accent);
    background: rgba(245, 158, 11, 0.1);
    padding: 2px 8px;
    border-radius: 5px;
  }
  .detail-box {
    text-align: left;
    background: #0e0e13;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 12.5px;
    line-height: 1.6;
    color: #d0d0dc;
    min-height: 20px;
    opacity: 0;
    animation: fadeUp 0.4s ease-out 0.9s forwards;
  }
  .cursor {
    display: inline-block;
    width: 7px;
    height: 14px;
    background: var(--accent);
    margin-left: 2px;
    vertical-align: middle;
    animation: blink 0.9s step-end infinite;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  .hint {
    margin-top: 20px;
    font-size: 11px;
    color: var(--text-dim);
    opacity: 0;
    animation: fadeUp 0.4s ease-out 1.1s forwards;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="logo-wrap">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g_drop" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#fbbf24"/>
            <stop offset="1" stop-color="#d97706"/>
          </linearGradient>
        </defs>
        <path d="M32 3 L59 15 V32 C59 47 47 58 32 62 C17 58 5 47 5 32 V15 Z" fill="url(#g_drop)" opacity="0.15"/>
        <path d="M32 3 L59 15 V32 C59 47 47 58 32 62 C17 58 5 47 5 32 V15 Z" stroke="url(#g_drop)" stroke-width="2"/>
        <path d="M32 18 L44 44 H37 L34.5 38 H29.5 L27 44 H20 L32 18 Z M32 27 L29.5 33 H34.5 L32 27 Z" fill="url(#g_drop)"/>
      </svg>
    </div>
    <div class="status-pill">DROPPED IN INTERCEPTOR</div>
    <h1>Aresius dropped this __ITEM_TYPE__</h1>
    <p class="target">Target: <code>__TARGET__</code></p>
    <div class="detail-box"><span id="typed"></span><span class="cursor"></span></div>
    <p class="hint">To forward traffic, click 'Forward' in the Interceptor or toggle Intercept off.</p>
  </div>
  <script>
    (function () {
      var text = __DETAIL_JSON__;
      var el = document.getElementById('typed');
      var i = 0;
      function tick() {
        if (i <= text.length) {
          el.textContent = text.slice(0, i);
          i++;
          setTimeout(tick, 14);
        }
      }
      setTimeout(tick, 950);
    })();
  </script>
</body>
</html>"##;

