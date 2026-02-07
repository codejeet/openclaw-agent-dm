#!/usr/bin/env node
import { Command } from 'commander';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import chalk from 'chalk';
import { execa } from 'execa';
import { generateKeyPair, exportJWK } from 'jose';
import { nanoid } from 'nanoid';

const program = new Command();

function oadmHome() {
  return process.env.OADM_HOME ?? path.join(os.homedir(), '.oadm');
}

function configPath() {
  return path.join(oadmHome(), 'config.json');
}

type Config = {
  bridgeId: string;
  authToken: string;
  port: number;
  bind: string;
  dbPath: string;
  agentAddress?: { gatewayUrl: string; agentId: string };
};

function readConfig(): Config {
  const p = configPath();
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function writeConfig(cfg: Config) {
  fs.mkdirSync(oadmHome(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function randomToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function ensureIdentityFiles() {
  const idPath = path.join(oadmHome(), 'identity.json');
  if (fs.existsSync(idPath)) return JSON.parse(fs.readFileSync(idPath, 'utf8'));

  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  const bridgeId = 'bridge:' + nanoid();
  const identity = { bridgeId, publicJwk, privateJwk, createdAt: new Date().toISOString() };
  fs.mkdirSync(oadmHome(), { recursive: true });
  fs.writeFileSync(idPath, JSON.stringify(identity, null, 2));
  return identity;
}

program
  .name('oadm')
  .description('OpenClaw Agent DM (OADM) CLI')
  .version('0.0.0');

program
  .command('init')
  .description('Initialize local bridge identity + config and start the bridge')
  .option('--port <port>', 'Port to bind', (v) => Number(v), 8787)
  .option('--bind <bind>', 'Bind host', '127.0.0.1')
  .option('--agent-gateway-url <url>', 'Default agent gatewayUrl to include in invites')
  .option('--agent-id <id>', 'Default agentId to include in invites')
  .action(async (opts) => {
    const home = oadmHome();
    fs.mkdirSync(home, { recursive: true });

    const identity = await ensureIdentityFiles();

    const cfg: Config = {
      bridgeId: identity.bridgeId,
      authToken: randomToken(),
      port: opts.port,
      bind: opts.bind,
      dbPath: path.join(home, 'oadm.sqlite'),
      agentAddress:
        opts.agentGatewayUrl && opts.agentId
          ? { gatewayUrl: opts.agentGatewayUrl, agentId: opts.agentId }
          : undefined,
    };

    writeConfig(cfg);

    console.log(chalk.green('✓ Initialized OADM'));
    console.log('Config:', chalk.cyan(configPath()));
    console.log('Auth token (paste into web UI):', chalk.yellow(cfg.authToken));

    console.log('\nStarting bridge...');
    const bridgeEntry = path.join(process.cwd(), 'apps/bridge/src/index.ts');
    // Run from monorepo checkout: use pnpm -C apps/bridge dev for dev; for now spawn tsx.
    await execa('pnpm', ['-C', path.join(process.cwd(), 'apps/bridge'), 'dev'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        OADM_HOME: home,
        OADM_PORT: String(cfg.port),
        OADM_BIND: cfg.bind,
        OADM_DB_PATH: cfg.dbPath,
        OADM_AUTH_TOKEN: cfg.authToken,
      },
    });
  });

program
  .command('tunnel')
  .description('Start a Cloudflare quick tunnel to expose your local bridge')
  .option('--url <url>', 'Local bridge URL', '')
  .action(async (opts) => {
    const cfg = readConfig();
    const localUrl = opts.url || `http://${cfg.bind}:${cfg.port}`;

    console.log(chalk.green('Starting Cloudflare quick tunnel...'));
    console.log('Local:', chalk.cyan(localUrl));
    console.log('Note: quick tunnels are usually NOT stable across restarts; for a stable URL, use a named tunnel.');

    // Requires user-installed cloudflared.
    console.log('\nIf you do not have cloudflared installed: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');

    await execa('cloudflared', ['tunnel', '--url', localUrl], { stdio: 'inherit' });
  });

program
  .command('invite')
  .description('Print an invite JSON blob (cap-token + agentAddress) to share')
  .requiredOption('--to-bridge-id <id>', 'Audience bridge id (ask your friend for theirs; for MVP you can set to a placeholder)')
  .option('--display-name <name>', 'Display name', 'Friend')
  .option('--agent-gateway-url <url>', 'agentAddress.gatewayUrl (usually your public BRIDGE_URL)', '')
  .option('--agent-id <id>', 'agentAddress.agentId', '')
  .option('--exp-seconds <n>', 'Expiry seconds', (v) => Number(v), 60 * 60 * 24 * 30)
  .action(async (opts) => {
    const identity = JSON.parse(fs.readFileSync(path.join(oadmHome(), 'identity.json'), 'utf8'));
    const cfg = readConfig();

    const gatewayUrl = opts.agentGatewayUrl || cfg.agentAddress?.gatewayUrl;
    const agentId = opts.agentId || cfg.agentAddress?.agentId;
    if (!gatewayUrl || !agentId) {
      console.error('Missing agentAddress. Provide --agent-gateway-url and --agent-id (or set them at init).');
      process.exit(1);
    }

    const { SignJWT, importJWK } = await import('jose');
    const key = await importJWK(identity.privateJwk, 'EdDSA');
    const now = Math.floor(Date.now() / 1000);

    const sub = JSON.stringify({ gatewayUrl, agentId });

    const capToken = await new SignJWT({ scope: ['dm'] })
      .setProtectedHeader({ alg: 'EdDSA', kid: identity.bridgeId, typ: 'JWT' })
      .setIssuedAt(now)
      .setIssuer(identity.bridgeId)
      .setSubject(sub)
      .setAudience(opts.toBridgeId)
      .setExpirationTime(now + opts.expSeconds)
      .setJti(nanoid())
      .sign(key);

    const invite = {
      displayName: opts.displayName,
      agentAddress: { gatewayUrl, agentId },
      capToken,
    };

    console.log(JSON.stringify(invite, null, 2));
  });

program.parseAsync(process.argv);
