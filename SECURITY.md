# Security policy

Browser Assistant runs against a loopback backend. Inference, diagnostics and history require a per-install pairing token. Keep the backend bound to loopback and protect the token, provider credentials and local database.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/JaswanthCodeHub/browser-assistant/security/advisories/new). Include the affected version, impact and reproducible steps using synthetic data. Keep credentials and private page content out of reports.

## Local precautions

- Keep populated environment files, pairing tokens, databases, screenshots and backups out of Git and releases.
- If a provider key is exposed, revoke it through the provider. To rotate local pairing, stop the backend, replace the configured token or remove the generated token file, then restart and pair again.
- Review the screenshot preview before sending. Question content sent to Groq is subject to the provider's retention policies.
- Use the panel only where you have permission. Generic websites support manual scans through the toolbar.
