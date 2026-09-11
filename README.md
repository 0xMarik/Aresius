<div align="center">

<img src="src-tauri/icons/icon.png" alt="Aresius Logo" width="120" />

# Aresius

### The lightweight, native interception proxy for security testing.

**Fast. Cross-platform. 100% Open Source.**

<p>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/0xMarik/Aresius?color=blue" alt="License" /></a>
  <a href="../../releases"><img src="https://img.shields.io/github/v/release/0xMarik/Aresius?color=green" alt="Release" /></a>
  <a href="../../stargazers"><img src="https://img.shields.io/github/stars/0xMarik/Aresius?style=flat" alt="Stars" /></a>
  <a href="https://reddit.com/r/aresius"><img src="https://img.shields.io/badge/Reddit-r%2Faresius-orange?logo=reddit" alt="Reddit Community" /></a>
  <img src="https://img.shields.io/badge/built%20with-Tauri%20%2B%20Rust-orange" alt="Built with Tauri + Rust" />
</p>

<p>
  <a href="#-quick-start"><strong>Quick Start</strong></a> ·
  <a href="#-features"><strong>Features</strong></a> ·
  <a href="#-why-aresius"><strong>Why Aresius</strong></a> ·
  <a href="#-installation"><strong>Install</strong></a> ·
  <a href="#-roadmap"><strong>Roadmap</strong></a> ·
  <a href="#-community"><strong>Community</strong></a> ·
  <a href="../../releases"><strong>Releases</strong></a>
</p>

<img src="docs/assets/screenshot.png" alt="Aresius screenshot" width="820" />

</div>

<br/>

## ⚡ What is Aresius?

**Aresius** is a native, modern desktop HTTP/HTTPS interception proxy designed for penetration testers and bug bounty hunters. 

Intercept and modify requests in real-time, fuzz without artificial rate limits, replay complex sessions with side-by-side diffing, and filter thousands of captured requests using **HTTPQL**—all with a minimal memory footprint and zero license fees.

Built on **Tauri + Rust** instead of Java or Electron, Aresius launches in under a second and stays light during long engagements.

<br/>

## 🚀 Quick Start

```bash
git clone https://github.com/0xMarik/Aresius.git
cd Aresius
bun install
bun run tauri dev
```

On first launch, Aresius automatically generates a local Root CA certificate. Trust it in your browser or operating system, point your proxy to `127.0.0.1:8080`, and you're ready to intercept HTTPS traffic.

<br/>

## ✨ Features

| Feature | Description |
|---|---|
| 📡 **Live Interceptor** | Intercept, inspect, tamper with, forward, or drop HTTP/HTTPS requests and responses in real time. |
| 🔁 **Request Replayer** | Edit and resend captured requests, organize into collections and sessions, and compare responses side-by-side with visual diffing. |
| 🎯 **High-Speed Fuzzer** | Powerful payload generator supporting **Rotator**, **Zipped**, **Echo**, and **Combinatorial** fuzzing with real-time dynamic thread scaling. |
| 🔍 **HTTPQL & Full-Text Search** | Query and filter proxy history in real-time using expressive HTTPQL syntax and SQLite-powered full-text search. |
| 🌲 **Sitemap & Scope Manager** | Automatic hierarchical endpoint discovery with granular domain and regex-based in-scope/out-of-scope rules. |
| 🔄 **Match & Replace** | Create automatic replacement rules for incoming and outgoing headers, parameters, and bodies. |
| 🪶 **Native Performance** | Native Rust backend, tiny installation size, instant startup, and low idle memory consumption (~60–80 MB). |
| 🖥️ **Cross-Platform** | Consistent, fluid native desktop experience across Windows, macOS, and Linux. |

<br/>

## 🥊 Why Aresius?

| Feature | Aresius | Burp Suite (Community) | Caido (Free) |
|---|:---:|:---:|:---:|
| **100% Open Source** | ✅ (AGPL-3.0) | ❌ Proprietary | ❌ Proprietary Core |
| **Native Architecture** | ✅ Rust + Tauri | ❌ Heavy JVM | ✅ Rust + Web |
| **Idle Memory Footprint** | ✅ ~60–80 MB | ❌ 1.5 GB – 3 GB+ | ✅ ~100–200 MB |
| **Unrestricted Fuzzing** | ✅ No limits | ❌ Throttled rate | ✅ Fast |
| **Full Project Persistence** | ✅ SQLite `.ares` | ❌ Paid Pro only | ⚠️ Limited in free tier |
| **Custom Match & Replace** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Side-by-Side Response Diff** | ✅ Built-in | ⚠️ Plugin required | ✅ Built-in |

<br/>

## 📦 Installation

### Prebuilt Binaries
Download the latest prebuilt installer or binary for your operating system from [**Releases**](../../releases).

### Build from Source

**Prerequisites:**
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Bun](https://bun.sh/) (or [Node.js](https://nodejs.org/))
- [Tauri Prerequisites](https://tauri.app/start/prerequisites/) for your OS

```bash
git clone https://github.com/0xMarik/Aresius.git
cd Aresius
bun install
bun run tauri build
```

The compiled binaries will be generated under `src-tauri/target/release/bundle/`.

<br/>

## 🛠️ Development

Run in development mode with live hot-reloading:

```bash
# Run dev server
bun run tauri dev
```

To run Rust backend unit tests:
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

<br/>

## 🗺️ Roadmap

- [ ] **Plugin Ecosystem:** Extensible JavaScript/TypeScript SDK for custom sidebar views, context menus, and workflow automation.
- [ ] **Business Logic Flow Mapper:** Visual node-graph canvas to model multi-step user journeys and detect IDORs, BOLA, and state bypasses.
- [ ] **Modular Scanner Engine:** Passive vulnerability inspection (CORS, sensitive leaks, missing headers) and active check plugins.
- [ ] **WebSocket Interception:** Deep inspection, tampering, and replay for WebSocket frames.

Have a feature request or idea? [Open a Discussion](../../discussions) or join our subreddit!

<br/>

## 💬 Community

- **Reddit:** [r/aresius](https://reddit.com/r/aresius) — Join for weekly feature demos, development updates, and tips.
- **GitHub Discussions:** [Discussions](../../discussions) — Ask questions, suggest features, and discuss workflows.
- **Issue Tracker:** [Issues](../../issues) — Report bugs or submit feature suggestions.

<br/>

## 🔒 Security

Aresius decrypts and handles sensitive traffic locally on your machine. Found a security issue in Aresius itself? Please report it responsibly according to [**SECURITY.md**](SECURITY.md).

<br/>

## 🤝 Contributing

Contributions are welcome! Please check out [**CONTRIBUTING.md**](CONTRIBUTING.md) to get started with pull requests, development conventions, and guidelines.

<br/>

## 📄 License

Aresius is licensed under the **GNU Affero General Public License v3.0**.  
See [**LICENSE**](LICENSE) for the full text.

---

<div align="center">

**Built with [Tauri](https://tauri.app/) · [Rust](https://www.rust-lang.org/) · [React](https://react.dev/)**

⭐ Star us on GitHub — it helps the project reach more security researchers!

</div>
