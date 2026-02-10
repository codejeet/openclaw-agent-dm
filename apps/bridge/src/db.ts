import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function resolveOadmHome(explicit?: string) {
  return explicit ?? process.env.OADM_HOME ?? path.join(os.homedir(), '.oadm');
}

export function resolveDbPath() {
  if (process.env.OADM_DB_PATH) return process.env.OADM_DB_PATH;
  const home = resolveOadmHome();
  return path.join(home, 'oadm.sqlite');
}

export function openDb(dbPath = resolveDbPath()) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    create table if not exists identity (
      id text primary key,
      pubKey text not null,
      privKey text not null,
      createdAt text not null
    );

    create table if not exists contacts (
      id text primary key,
      displayName text not null,
      agentGatewayUrl text not null,
      agentId text not null,
      capToken text not null,
      createdAt text not null
    );

    create table if not exists messages (
      id text primary key,
      contactId text not null,
      direction text not null,
      text text not null,
      status text not null,
      createdAt text not null,
      rawJson text,
      foreign key(contactId) references contacts(id)
    );
  `);

  return db;
}
