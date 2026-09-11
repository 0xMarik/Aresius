# Contributing to Aresius

Thank you for your interest in contributing to **Aresius**! 

Aresius is an open-source, native interception proxy built with **Tauri + Rust** and **React + TypeScript**. We welcome all contributions—bug fixes, new features, performance optimizations, documentation improvements, or UI refinements.

---

## 🧭 Table of Contents

1. [Code of Conduct](#-code-of-conduct)
2. [Development Setup](#-development-setup)
3. [Project Architecture](#-project-architecture)
4. [Development Workflow](#-development-workflow)
5. [Commit Conventions](#-commit-conventions)
6. [Submitting a Pull Request](#-submitting-a-pull-request)
7. [Getting Help & Community](#-getting-help--community)

---

## 🤝 Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for everyone, regardless of experience level. Please be respectful, constructive, and kind in all discussions, issues, and pull requests.

---

## 🛠️ Development Setup

### 1. Prerequisites
Ensure you have the following installed on your machine:

- **[Rust](https://www.rust-lang.org/tools/install)** (stable, 1.80+ recommended)
- **[Bun](https://bun.sh/)** (recommended) or [Node.js](https://nodejs.org/) (v18+)
- **[Tauri Prerequisites](https://tauri.app/start/prerequisites/)** for your operating system:
  - **Windows:** Microsoft Visual Studio C++ Build Tools & WebView2.
  - **Linux:** `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.
  - **macOS:** Xcode Command Line Tools.

### 2. Clone and Install

```bash
git clone https://github.com/0xMarik/Aresius.git
cd Aresius

# Install frontend dependencies
bun install
```

### 3. Run in Development Mode

```bash
bun run tauri dev
```

This starts the Vite dev server with Hot Module Replacement (HMR) and compiles the Rust backend. On first run, Cargo will download and compile dependencies.

---

## 🏛️ Project Architecture

Aresius is divided into two primary layers:

```text
Aresius/
├── src/                         # FRONTEND (React 18 + TypeScript + Vite)
│   ├── pages/                   # Application views (HttpHistory, Replayer, Fuzzer, etc.)
│   ├── components/              # UI components (Radix/shadcn-ui, tables, editors)
│   ├── store/                   # Redux Toolkit state slices (httpHistory, fuzzer, etc.)
│   ├── hooks/                   # Custom React hooks (IPC poller, theme, project state)
│   └── types/                   # Shared TypeScript interfaces
│
├── src-tauri/                   # BACKEND (Rust + Tauri v2)
│   ├── src/
│   │   ├── proxy/               # MITM HTTP/TLS proxy engine & interceptor
│   │   ├── fuzzer/              # Rotator, Zipped, Echo, Combinatorial engines
│   │   ├── commands/            # Tauri invoke handlers called by frontend
│   │   ├── ares_utils/          # SQLite database (sqlx), certs, HTTPQL parser, logger
│   │   └── lib.rs               # Main application setup and command registration
│   └── Cargo.toml               # Rust dependencies
```

---

## 🧪 Development Workflow

### Frontend Code Quality
- **TypeScript:** Ensure there are no type errors before submitting PRs.
  ```bash
  bun run build
  ```
- **Styling:** We use [Tailwind CSS](https://tailwindcss.com/) alongside [Lucide React](https://lucide.dev/) icons. Keep UI components consistent with the existing dark theme and typography.

### Backend Code Quality
- **Unit Tests:** Always run and add unit tests when modifying core proxy or fuzzer logic:
  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml
  ```
- **Formatting & Linting:**
  ```bash
  cargo fmt --manifest-path src-tauri/Cargo.toml --check
  cargo clippy --manifest-path src-tauri/Cargo.toml
  ```

---

## 📝 Commit Conventions

We follow a clean, descriptive prefix format for commits:

| Prefix | Description | Example |
| :--- | :--- | :--- |
| `add:` | Adding a new feature or capability | `add: dynamic thread scaling in fuzzer` |
| `fix:` | Fixing a bug or unexpected behavior | `fix: httpql live query suggestion list` |
| `optimise:` / `optimize:` | Performance or memory improvement | `optimise: heap-allocate async chunk buffers` |
| `refactor:` | Code restructuring without changing behavior | `refactor: extract replayer session logic` |
| `docs:` | Documentation changes | `docs: update quick start and contributing guide` |

---

## 🚀 Submitting a Pull Request

1. **Fork the Repository:** Create a personal fork on GitHub.
2. **Create a Feature Branch:**
   ```bash
   git checkout -b feat/my-new-feature
   # or
   git checkout -b fix/issue-description
   ```
3. **Keep Commits Atomic:** Group related changes together with clear commit messages.
4. **Test Thoroughly:** Verify that:
   - The application builds cleanly (`bun run tauri build`).
   - Rust tests pass (`cargo test --manifest-path src-tauri/Cargo.toml`).
   - No regressions are introduced to proxy interception or history storage.
5. **Open a Pull Request:**
   - Provide a clear summary of what changes were made and why.
   - Link any related GitHub issues (e.g. `Fixes #42`).
   - Include screenshots or GIFs for UI modifications.

---

## 💬 Getting Help & Community

Have questions before you start coding? Want to pitch an idea first?

- **Reddit:** [r/aresius](https://reddit.com/r/aresius)
- **GitHub Discussions:** [Open a Discussion](https://github.com/0xMarik/Aresius/discussions)
- **Issue Tracker:** [GitHub Issues](https://github.com/0xMarik/Aresius/issues)

Thank you for helping make Aresius the best open-source security proxy!
