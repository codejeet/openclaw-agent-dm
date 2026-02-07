export type AgentAddress = {
  gatewayUrl: string;
  agentId: string;
};

export type Contact = {
  id: string;
  displayName: string;
  agentAddress: AgentAddress;
  capToken: string;
  createdAt: string;
};

export type MessageRow = {
  id: string;
  contactId: string;
  direction: 'in' | 'out';
  text: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  createdAt: string;
  rawJson: string | null;
};
