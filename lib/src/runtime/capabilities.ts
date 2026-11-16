import { readFileSync } from 'node:fs';
export type CapabilityStatus = 'exact-contract' | 'behavior-tested' | 'approximate' | 'unsupported';
export const profile = JSON.parse(readFileSync(new URL('../../profiles/claude-code-2.1.310.json', import.meta.url), 'utf8')) as {
  version: number; target: string; pi: string; promptCommit: string; strictTools: boolean; capabilities: Record<string, CapabilityStatus>;
};
export const capabilityReport = () => ({ ...profile, limitations: ['No live Claude CLI comparison has been run.', 'Shell calls are approved as opaque programs; no OS sandbox is claimed.', 'Plan mode blocks all shell and unrecognized tool execution.', 'Only compatibility file tools participate in rewind.', 'Imported prompt inventory is incomplete.'] });
