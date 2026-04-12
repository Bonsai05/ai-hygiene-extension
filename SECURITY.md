# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.x (current) | ✅ Active |

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub Issue for security vulnerabilities.**

If you discover a security issue — including bypass techniques for the phishing detection engine, XP manipulation exploits, or unintended data leaks — please report it privately so that a patch can be prepared before public disclosure.

### How to Report

Email: **security@your-org.example.com**  
*(Replace this with your actual security contact address before publishing)*

Include in your report:
- A clear description of the vulnerability
- Steps to reproduce
- Potential impact (what an attacker could achieve)
- Chrome version and extension version

### What to Expect

- **Acknowledgement within 48 hours** of your report
- **Status update within 7 days** with an assessment of severity
- **A patch within 30 days** for confirmed vulnerabilities (or a clear explanation if no fix is warranted)
- **Credit in the release notes** if you would like to be acknowledged

We follow [responsible disclosure](https://en.wikipedia.org/wiki/Responsible_disclosure) — please allow us time to release a fix before publishing details publicly.

---

## Threat Model

The AI Hygiene Companion is designed with the following security boundaries in mind:

### In Scope
- Bypass of phishing detection via URL obfuscation
- XP/badge manipulation through crafted page content or timing attacks
- Privilege escalation via the offscreen document or content script bridge
- Data leakage of browsing history to third parties

### Out of Scope
- Attacks requiring physical access to the device
- Vulnerabilities in Chrome itself (report those to [Google](https://bughunters.google.com/))
- Vulnerabilities in the HuggingFace model hub (report those to HuggingFace)
- Social engineering of end users (outside the extension's control)

---

## Privacy Commitment

This extension processes all data locally. No URLs, page content, or user statistics are transmitted to external servers during normal operation. The only external network call is the one-time model weight download from `huggingface.co` when the extension is first installed.
