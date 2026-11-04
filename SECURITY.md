# Security policy

This project is intended for local use. The backend has no token authentication or TLS; keep the default loopback binding. Host/origin guards block untrusted website requests and DNS-rebinding Host values, while other software on the same computer remains outside that boundary. Broad extension permissions, page editor operations, cloud prompts, and stored answers deserve review before use. AI or model review is not a security guarantee.

## Report privately

Do not post vulnerabilities, credentials, or private page content in public issues. Once the GitHub owner enables private vulnerability reporting, use the repository Security tab's **Report a vulnerability** option. A private reporting contact has not yet been configured; this is a launch blocker. Until then, ask the owner for a private channel without including exploit details.

Include affected revision, reproducible steps using synthetic data, impact, and suggested mitigation. No supported-version matrix or response deadline is promised yet. Review the current development branch; a maintenance policy should be agreed before public releases.

## Local precautions

- Keep populated `.env` files, databases, screenshots, logs, and backups out of Git and releases.
- A compromised API key must be revoked/rotated at the provider; removing it from Git is insufficient. Application key switching on rate limits is not security rotation.
- Review visible content before vision capture: there is no redaction and Groq receives the image.
- Clear History deletes database rows, not copies, backups, or provider records. Stop the server before removing database files.
- Use automation only with permission; generic HTTP/HTTPS targets are enabled in the current policy.
- Minimal/stealth modes do not establish invisibility, access control, or confidentiality.
