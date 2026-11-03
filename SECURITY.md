# Security policy

Please report a suspected security issue privately through GitHub's **Report a vulnerability** link for this repository, when available. If that link is not enabled, contact the repository owner through their GitHub profile to arrange a private channel. Do not put credentials, private account details, or an exploit in a public issue.

Include the affected revision, impact, minimal reproduction, and any relevant sanitized logs. Avoid testing against the live dashboard in ways that alter data or disrupt riders. We will acknowledge reports and coordinate a fix and disclosure with the reporter.

The app's public transit feeds need no credential. Optional Bluesky and map credentials belong in environment variables or a secret store, never in source or issue attachments. Runtime SQLite, Parquet, backups, and account sessions must remain outside Git.
