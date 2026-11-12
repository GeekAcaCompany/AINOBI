# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting: open the repository's Security tab and choose "Report a vulnerability". Do not open a public issue.

Note for maintainers: GitHub offers private vulnerability reporting only for public repositories. Enable it in the repository settings on the day the repository is made public, then delete this paragraph.

## Security model

This describes what `npm start` runs: Studio, the courseware service, and the embedded stores, on one machine for one person.

- **Loopback only.** Every server listens on `127.0.0.1`. Studio and its local host also refuse a request whose `Host` header is not `127.0.0.1` or `localhost` on their own port. There is one user and no sign-in, so do not expose these ports. To run AINOBI for several people, put your own sign-in in front of the courseware service; see the [integration guide](docs/integration.md#connecting-your-own-system).
- **The local access token.** The first start generates a random token and stores it in `.ainobi/secrets.json` and `.mcp.json`. Both files are ignored by git and written with mode 0600, which Windows does not apply. The token gives full access to your local courseware, so keep both files out of anything you share. Studio gives the token only to its own pages: the session route sends no CORS headers and refuses requests from other origins.
- **Framing.** Studio's pages send `frame-ancestors 'self'`, so no other site can frame them unless you list it in `AINOBI_EMBED_ORIGINS`. Anyone who can open a page that frames Studio acts as the local user.
- **Courseware is active content.** A slide can contain HTML elements, and their scripts run when the slide is shown. They run in iframes, but HTML written into a slide is given the Studio page's origin (`allow-same-origin`), so its scripts can do what the local user can, including reading the local access token. Pages converted from uploaded PDF and PowerPoint files run in iframes without that origin. Open courseware only from sources you trust, as you would a program.
- **Provider keys.** Keys in `.env.local` are read by the server processes. The Studio page receives the local access token and no provider keys. `.env` files are ignored by git.
- **Coding agents.** An agent connected over MCP holds the local access token and can read and change all local courseware. Teaching materials and web results an agent reads are data, not instructions.
- **The editor's AI assistant.** When configured, it runs an agent process on your machine through the Claude Agent SDK, and that agent can run shell commands. On macOS its shell runs in the SDK's sandbox, limited to its workspace; `AINOBI_AGENT_DISABLE_SANDBOX=true` turns that off. On Windows and Linux there is no sandbox by default: the courseware service checks each command and file path and refuses those that leave the workspace, start another shell, or read credentials, but a filter of this kind is not a security boundary. Treat the assistant there as able to act as you, and do not point it at material you do not trust. `AINOBI_AGENT_FORCE_SANDBOX=true` requests the sandbox on Linux, where it needs bubblewrap and socat.
- **Optional containers.** The video renderer and the document converters run in Docker containers you start yourself. Their ports are published by the `docker run` commands in the guides; bind them to `127.0.0.1` if other machines can reach yours.
