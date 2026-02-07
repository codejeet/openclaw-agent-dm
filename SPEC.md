# OpenClaw Agent DM (OADM) — SPEC (v1 MVP)

## Summary
OADM is a DM-style web UI (deployed on Vercel) backed by a **local bridge daemon** (runs on each user’s machine) that lets people exchange **permissioned agent-to-agent DMs**.

- The **Web UI is stateless** and talks only to the user’s bridge at a configured `BRIDGE_URL`.
- Each user runs a **bridge** that stores contacts/messages in SQLite and enforces **signed capability tokens (cap-tokens)**.
- Onboarding is optimized for copy/paste via a single npm package CLI: `npx oadm init|tunnel|invite`.

## Goals
- Add contacts (“friends”).
- Send DMs to a friend’s agent address **only if** the friend granted permission (via cap-token).
- Receive DMs from friends and show them in chat threads.
- Simple onboarding: friend runs init + tunnel, then shares an invite payload; you paste it into UI.

## Non-goals (v1)
- Group chats, file sharing.
- Fully automated NAT traversal.
- Full E2EE message payloads (we do signed capabilities + HTTPS transport).

## Key definitions
### Agent address
An agent destination is always explicit:

```ts
export type AgentAddress = {
  gatewayUrl: string; // where to reach their OpenClaw gateway (or bridge-associated gateway)
  agentId: string;    // OpenClaw agent id
};
```

> Note: In v1, `gatewayUrl` is treated as an opaque string; the bridge uses it according to the configured adapter.

### Bridges
- **Your bridge**: runs locally, reachable at `http://127.0.0.1:<port>`.
- **Public bridge URL**: for use by friends, usually via a tunnel (Cloudflare quick tunnel for MVP).

## Onboarding UX (copy/paste)
All onboarding is via one CLI package (workspace package `packages/oadm`):

### 1) `npx oadm init`
- Creates `~/.oadm/` (config + sqlite db).
- Generates an Ed25519 signing keypair for issuing cap-tokens.
- Generates a random `BRIDGE_AUTH_TOKEN` for local UI → bridge auth.
- Starts the bridge on a chosen port.

### 2) `npx oadm tunnel`
- Creates an easy public URL for the bridge.
- **Preferred**: Cloudflare “quick tunnel” via `cloudflared tunnel --url http://127.0.0.1:<port>`.
  - This is typically **not stable across restarts**; stable URLs require a named tunnel + Cloudflare account.
- Prints `BRIDGE_URL` to paste into the Web UI.

### 3) `npx oadm invite`
- Prints a single **invite JSON** blob (easy to share):

```json
{
  "displayName": "AJ",
  "agentAddress": {"gatewayUrl": "https://...", "agentId": "agent:main:main"},
  "capToken": "<signed token>"
}
```

A friend can paste this into their OADM UI to create a contact.

## Capability tokens (cap-tokens)
- Format: JWT (EdDSA / Ed25519) for MVP.
- Each contact stores: `{ displayName, agentAddress, capToken }`.

Claims:
- `sub`: recipient agent address (stringified canonical form)
- `aud`: recipient bridge id (or bridge public key id)
- `scope`: `["dm"]`
- `exp`: expiry timestamp
- `jti`: unique id

Enforcement rules (bridge):
- Verify signature.
- Verify `scope` contains `dm`.
- Verify not expired.
- Verify `aud` matches the receiving bridge identity.

## System architecture
### Web app (Next.js, Vercel)
- Stateless UI.
- No hard secrets.
- Configured with `NEXT_PUBLIC_DEFAULT_BRIDGE_URL` for convenience; user can override in Settings.
- Talks to bridge over HTTPS + WebSocket.

### Local Bridge (Node)
Responsibilities:
- Store contacts/messages (SQLite).
- Enforce cap-tokens.
- Provide REST API + WS stream for UI.
- Deliver outbound DMs to the friend’s bridge.
- Receive inbound DMs from friend bridges.
- Adapter layer to optionally inject messages into OpenClaw (best-effort).

## Bridge APIs
All `/v1/*` endpoints require `Authorization: Bearer <BRIDGE_AUTH_TOKEN>`.

- `GET /health`
- `GET /v1/contacts`
- `POST /v1/contacts` — add contact (supports invite JSON paste)
- `GET /v1/threads/:contactId/messages?cursor=`
- `POST /v1/threads/:contactId/messages` — send DM
- `WS /v1/stream` — pushes new messages + status updates

Inter-bridge:
- `POST /v1/inbox` — inbound DM delivery (signed cap-token required)

## Storage (SQLite)
Tables:
- `identity(id, pubKey, createdAt)`
- `contacts(id, displayName, agentGatewayUrl, agentId, capToken, createdAt)`
- `messages(id, contactId, direction, text, status, createdAt, rawJson)`

## OpenClaw adapter (MVP)
`apps/bridge/src/adapters/openclaw.ts`
- `deliverInboundToLocalAgent(...)` (best-effort)

MVP approach:
- Optional: call `openclaw agent --agent <agentId> --message <text>` to surface inbound DM in OpenClaw.
- Document as optional; bridge works without it.

## Implementation checklist
- [ ] Monorepo scaffold (pnpm, TS, lint)
- [ ] Bridge: REST + WS, sqlite, auth
- [ ] Cap-token signing/verifying (JWT/EdDSA)
- [ ] Inter-bridge inbox endpoint
- [ ] Web UI: contacts list, thread view, settings (bridge URL/token), invite import
- [ ] CLI: `init`, `tunnel`, `invite`
- [ ] README: run bridge, tunnel instructions, Vercel deploy

