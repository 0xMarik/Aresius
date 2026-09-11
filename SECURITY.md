# Security Policy

Aresius is designed for security testing and penetration testing. Because it decrypts, inspects, and stores potentially sensitive HTTP/HTTPS traffic locally on your machine, security and data integrity are top priorities.

---

## 🛡️ Supported Versions

We provide security updates and patches for the following versions of Aresius:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability in Aresius, please **do NOT create a public issue**. 

Instead, report it responsibly through one of the following channels:

1. **GitHub Private Vulnerability Reporting (Preferred):**
   * Navigate to the [Security tab](https://github.com/0xMarik/Aresius/security) of the Aresius repository.
   * Click on **"Report a vulnerability"** to open a private advisory.

2. **Direct Contact:**
   * If private reporting is unavailable, reach out directly to the maintainer via email at **contact.aresius@gmail.com** (or open a minimal issue requesting a private security contact).

---

## 📋 What to Include in Your Report

To help us triage and resolve the issue quickly, please include:

- A clear description of the vulnerability and its potential impact.
- Affected Aresius version(s) and operating system (Windows, macOS, Linux).
- Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
- Any suggested remediations or patches, if available.

---

## ⏱️ Response Timeline

- **Initial Response:** Within **48 hours** of receiving your report.
- **Triage & Assessment:** We will verify the issue, determine severity, and keep you informed of our progress.
- **Fix & Disclosure:** We will coordinate a patch and an agreed-upon public disclosure date (typically within 30–90 days, depending on severity).

---

## 🎯 Scope Guidelines

### In Scope
- Remote code execution (RCE) via malicious intercepted traffic, crafted responses, or WebSocket payloads.
- Local privilege escalation or unauthorized file access via the Tauri IPC boundary.
- Insecure storage or exposure of private keys / root CA credentials.
- Denial of Service (crash or infinite loops) triggered by processing malformed HTTP/TLS streams.
- Bypasses of internal project isolation or SQLite database tampering.

### Out of Scope
- Issues requiring physical access to an unlocked host machine.
- Man-in-the-middle attacks where an attacker already possesses administrative/root privileges on the host OS.
- Expected functionality of an interception proxy (e.g., Aresius intercepting traffic because the user explicitly trusted the CA and routed traffic through it).
- Social engineering attacks against maintainers or contributors.

---

Thank you for helping keep Aresius and the security community safe!
