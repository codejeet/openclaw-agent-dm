'use client';

import { useEffect, useMemo, useState } from 'react';

type AgentAddress = { gatewayUrl: string; agentId: string };

type Contact = {
  id: string;
  displayName: string;
  agentAddress: AgentAddress;
  capToken: string;
  createdAt: string;
};

type Msg = {
  id: string;
  contactId: string;
  direction: 'in' | 'out';
  text: string;
  status: string;
  createdAt: string;
};

function useLocalStorage(key: string, initialValue: string) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    const v = window.localStorage.getItem(key);
    if (v) setValue(v);
  }, [key]);
  useEffect(() => {
    window.localStorage.setItem(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}

export default function Home() {
  const [bridgeUrl, setBridgeUrl] = useLocalStorage(
    'oadm.bridgeUrl',
    process.env.NEXT_PUBLIC_DEFAULT_BRIDGE_URL ?? 'http://127.0.0.1:8787'
  );
  const [bridgeToken, setBridgeToken] = useLocalStorage('oadm.bridgeToken', '');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const selected = useMemo(() => contacts.find((c) => c.id === selectedId) ?? null, [contacts, selectedId]);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [inviteJson, setInviteJson] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>('');

  async function api(path: string, init?: RequestInit) {
    setError('');
    const r = await fetch(new URL(path, bridgeUrl), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${bridgeToken}`,
        'content-type': 'application/json',
      },
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  }

  async function refreshContacts() {
    const data = await api('/v1/contacts');
    setContacts(data.contacts);
    if (!selectedId && data.contacts?.[0]?.id) setSelectedId(data.contacts[0].id);
  }

  async function refreshMessages(contactId: string) {
    const data = await api(`/v1/threads/${contactId}/messages`);
    setMessages(data.messages);
  }

  useEffect(() => {
    if (!bridgeToken) return;
    refreshContacts().catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeUrl, bridgeToken]);

  useEffect(() => {
    if (!selectedId || !bridgeToken) return;
    refreshMessages(selectedId).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!bridgeToken) return;
    const wsUrl = new URL('/v1/stream', bridgeUrl);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const evt = JSON.parse(ev.data);
        if (evt.type === 'contact.new') refreshContacts();
        if (evt.type === 'message.new' && evt.message?.contactId === selectedId) refreshMessages(selectedId);
        if (evt.type === 'message.status' && evt.id) refreshMessages(selectedId);
      } catch {
        // ignore
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeUrl, bridgeToken, selectedId]);

  async function addContactFromInvite() {
    const obj = JSON.parse(inviteJson);
    await api('/v1/contacts', { method: 'POST', body: JSON.stringify(obj) });
    setInviteJson('');
    await refreshContacts();
  }

  async function send() {
    if (!selected) return;
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await api(`/v1/threads/${selected.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    await refreshMessages(selected.id);
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">OpenClaw Agent DM</h1>
          <div className="text-xs text-neutral-400">Bridge: {bridgeUrl}</div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="text-sm font-semibold">Settings</h2>
              <div className="mt-3 space-y-2">
                <label className="block text-xs text-neutral-400">BRIDGE_URL</label>
                <input
                  className="w-full rounded bg-neutral-950 p-2 text-sm"
                  value={bridgeUrl}
                  onChange={(e) => setBridgeUrl(e.target.value)}
                />
                <label className="block text-xs text-neutral-400">Bridge auth token</label>
                <input
                  className="w-full rounded bg-neutral-950 p-2 text-sm"
                  value={bridgeToken}
                  onChange={(e) => setBridgeToken(e.target.value)}
                  placeholder="paste OADM_AUTH_TOKEN"
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Contacts</h2>
                <button
                  className="rounded bg-neutral-800 px-2 py-1 text-xs"
                  onClick={() => refreshContacts().catch((e) => setError(String(e)))}
                >
                  Refresh
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {contacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full rounded p-2 text-left text-sm ${c.id === selectedId ? 'bg-neutral-800' : 'bg-neutral-950'}`}
                  >
                    <div className="font-medium">{c.displayName}</div>
                    <div className="truncate text-xs text-neutral-400">
                      {c.agentAddress.gatewayUrl} · {c.agentAddress.agentId}
                    </div>
                  </button>
                ))}
                {!contacts.length && <div className="text-xs text-neutral-500">No contacts yet. Paste an invite below.</div>}
              </div>

              <div className="mt-4">
                <h3 className="text-xs font-semibold text-neutral-400">Add contact (paste invite JSON)</h3>
                <textarea
                  className="mt-2 w-full rounded bg-neutral-950 p-2 text-xs"
                  rows={6}
                  value={inviteJson}
                  onChange={(e) => setInviteJson(e.target.value)}
                />
                <button
                  className="mt-2 rounded bg-blue-600 px-3 py-2 text-sm"
                  onClick={() => addContactFromInvite().catch((e) => setError(String(e)))}
                >
                  Add Contact
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="text-sm font-semibold">Thread</h2>
              {!selected && <div className="mt-4 text-sm text-neutral-400">Select a contact.</div>}
              {selected && (
                <>
                  <div className="mt-3 h-[420px] overflow-y-auto rounded bg-neutral-950 p-3">
                    {messages.map((m) => (
                      <div key={m.id} className={`mb-2 flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[80%] rounded px-3 py-2 text-sm ${m.direction === 'out' ? 'bg-blue-700' : 'bg-neutral-800'}`}
                        >
                          <div className="whitespace-pre-wrap">{m.text}</div>
                          <div className="mt-1 text-[10px] text-neutral-200/70">
                            {new Date(m.createdAt).toLocaleString()} · {m.status}
                          </div>
                        </div>
                      </div>
                    ))}
                    {!messages.length && <div className="text-sm text-neutral-500">No messages yet.</div>}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      className="flex-1 rounded bg-neutral-950 p-2 text-sm"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Type a message"
                    />
                    <button className="rounded bg-blue-600 px-3 py-2 text-sm" onClick={() => send().catch((e) => setError(String(e)))}>
                      Send
                    </button>
                  </div>
                </>
              )}
            </div>

            {error && <div className="mt-4 rounded border border-red-900 bg-red-950 p-3 text-sm text-red-200">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
