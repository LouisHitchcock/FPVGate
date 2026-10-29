# GitHub to Discord notifications

This standalone Cloudflare Worker forwards GitHub webhook events to the FPVGate
Discord server. It is independent of the firmware, device web interface and
release build. Its deployment status cannot be established from this repository;
the source is retained here for maintaining any existing deployment.

Run Wrangler from this directory so it picks up `wrangler.toml`. Configure secrets
with `wrangler secret put DISCORD_WEBHOOK_URL` and
`wrangler secret put GITHUB_WEBHOOK_SECRET` before deploying with `wrangler deploy`.
The worker's name and entry point are unchanged. Moving this source does not
change an already deployed worker or its GitHub webhook configuration.

The avatar URL points to `images/logo/WhiteLogo.png` on `V1.9.0-alpha`. Publish the
image at that path before deploying this version of the worker; adjust the ref
if deploying from another branch.

This service is independent of the device's LED webhooks and RotorHazard API.
No bot deployment or webhook change is performed by building the alpha firmware.
See [repository layout](../../docs/REPOSITORY_LAYOUT.md).
