import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { loadEnv } from './env.js';
import { openDb, resolveOadmHome } from './db.js';
import { requireBearer } from './auth.js';
import { makeBroadcaster } from './stream.js';
import { verifyCapToken } from './capTokens.js';

const env = loadEnv();
const db = openDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/v1/stream' });
const broadcast = makeBroadcaster(wss);

const BRIDGE_ID = process.env.OADM_BRIDGE_ID ?? 'bridge:' + nanoid();

// Load bridge keypair from db (created by CLI init)
const identityRow = db
  .prepare('select id, pubKey, privKey from identity limit 1')
  .get() as { id: string; pubKey: string; privKey: string } | undefined;

if (!identityRow) {
  console.error('No identity found. Run `npx oadm init` first.');
  process.exit(1);
}

const publicJwk = JSON.parse(identityRow.pubKey) as any;

app.get('/health', (_req, res) => {
  res.json({ ok: true, bridgeId: identityRow.id, home: resolveOadmHome(), version: '0.0.0' });
});

// Inter-bridge inbox (no UI auth)
app.post('/v1/inbox', async (req, res) => {
  const body = req.body as any;
  const capToken = body?.capToken as string | undefined;
  const text = body?.text as string | undefined;
  const from = body?.from as any;

  if (!capToken || !text) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }

  try {
    await verifyCapToken({
      token: capToken,
      publicJwk,
      expectedAudience: identityRow.id,
      expectedScope: 'dm',
    });
  } catch {
    res.status(403).json({ error: 'cap_token_invalid' });
    return;
  }

  // Best-effort: identify sender; MVP stores one contact per sender bridgeId.
  const fromBridgeId = String(from?.bridgeId ?? 'unknown');

  let contact = db.prepare('select id, displayName from contacts where displayName=?').get(`Friend (${fromBridgeId})`) as any;

  if (!contact) {
    const id = nanoid();
    const createdAt = new Date().toISOString();
    // We do not know their agentAddress from inbox; store placeholders.
    db.prepare(
      'insert into contacts(id, displayName, agentGatewayUrl, agentId, capToken, createdAt) values(?,?,?,?,?,?)'
    ).run(id, `Friend (${fromBridgeId})`, 'unknown', 'unknown', capToken, createdAt);
    contact = { id, displayName: `Friend (${fromBridgeId})` };
    broadcast({ type: 'contact.new', contact });
  }

  const msgId = nanoid();
  const createdAt = new Date().toISOString();
  db.prepare(
    'insert into messages(id, contactId, direction, text, status, createdAt, rawJson) values(?,?,?,?,?,?,?)'
  ).run(msgId, contact.id, 'in', text, 'delivered', createdAt, JSON.stringify(body));

  broadcast({ type: 'message.new', message: { id: msgId, contactId: contact.id, direction: 'in', text, status: 'delivered', createdAt } });
  res.json({ ok: true });
});

// UI auth
app.use('/v1', requireBearer(env.OADM_AUTH_TOKEN));

app.get('/v1/contacts', (_req, res) => {
  const rows = db
    .prepare(
      'select id, displayName, agentGatewayUrl, agentId, capToken, createdAt from contacts order by createdAt desc'
    )
    .all();
  res.json({ contacts: rows.map((r: any) => ({
    id: r.id,
    displayName: r.displayName,
    agentAddress: { gatewayUrl: r.agentGatewayUrl, agentId: r.agentId },
    capToken: r.capToken,
    createdAt: r.createdAt,
  })) });
});

const InviteSchema = z.object({
  displayName: z.string().min(1),
  agentAddress: z.object({ gatewayUrl: z.string().min(1), agentId: z.string().min(1) }),
  capToken: z.string().min(10),
});

app.post('/v1/contacts', (req, res) => {
  const parsed = InviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
    return;
  }
  const id = nanoid();
  const createdAt = new Date().toISOString();
  db.prepare(
    'insert into contacts(id, displayName, agentGatewayUrl, agentId, capToken, createdAt) values(?,?,?,?,?,?)'
  ).run(
    id,
    parsed.data.displayName,
    parsed.data.agentAddress.gatewayUrl,
    parsed.data.agentAddress.agentId,
    parsed.data.capToken,
    createdAt
  );

  const contact = { id, ...parsed.data, createdAt };
  broadcast({ type: 'contact.new', contact });
  res.json({ contact });
});

app.get('/v1/threads/:contactId/messages', (req, res) => {
  const contactId = req.params.contactId;
  const rows = db
    .prepare(
      'select id, contactId, direction, text, status, createdAt, rawJson from messages where contactId=? order by createdAt asc limit 200'
    )
    .all(contactId);
  res.json({ messages: rows });
});

const SendSchema = z.object({ text: z.string().min(1).max(4000) });

app.post('/v1/threads/:contactId/messages', async (req, res) => {
  const contactId = req.params.contactId;
  const parsed = SendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const contact = db
    .prepare('select id, displayName, agentGatewayUrl, agentId, capToken from contacts where id=?')
    .get(contactId) as any;
  if (!contact) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const msgId = nanoid();
  const createdAt = new Date().toISOString();
  db.prepare(
    'insert into messages(id, contactId, direction, text, status, createdAt, rawJson) values(?,?,?,?,?,?,?)'
  ).run(msgId, contactId, 'out', parsed.data.text, 'queued', createdAt, null);

  broadcast({ type: 'message.new', message: { id: msgId, contactId, direction: 'out', text: parsed.data.text, status: 'queued', createdAt } });

  // Deliver to friend bridge inbox
  try {
    const inboxUrl = new URL('/v1/inbox', contact.agentGatewayUrl).toString();
    const body = {
      from: { bridgeId: identityRow.id },
      to: { agentAddress: { gatewayUrl: contact.agentGatewayUrl, agentId: contact.agentId } },
      text: parsed.data.text,
      capToken: contact.capToken,
      sentAt: createdAt,
    };

    const r = await fetch(inboxUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('inbox_http_' + r.status);

    db.prepare('update messages set status=? where id=?').run('sent', msgId);
    broadcast({ type: 'message.status', id: msgId, status: 'sent' });
  } catch (e: any) {
    db.prepare('update messages set status=? where id=?').run('failed', msgId);
    broadcast({ type: 'message.status', id: msgId, status: 'failed' });
  }

  res.json({ ok: true, id: msgId });
});

server.listen(env.OADM_PORT, env.OADM_BIND, () => {
  console.log(`OADM bridge listening on http://${env.OADM_BIND}:${env.OADM_PORT}`);
});
