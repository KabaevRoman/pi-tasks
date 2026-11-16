import type { Mode } from './config.ts';
export interface Task { id: string; subject: string; description: string; activeForm?: string; status: 'pending' | 'in_progress' | 'completed'; blockedBy: string[]; blocks: string[]; owner?: string; metadata?: Record<string, unknown> }
export interface Checkpoint { path: string; before: string | null; after: string }
export interface WorkflowState {
  version: 1;
  mode: Mode;
  plan?: { path: string; previousMode: Mode; approvedHash?: string; status: 'draft' | 'approved' | 'rejected' };
  tasks: Record<string, Task>;
  nextTask: number;
  checkpoints: Checkpoint[];
}
export const initialState = (): WorkflowState => ({ version: 1, mode: 'default', tasks: {}, nextTask: 1, checkpoints: [] });
export function restore(entries: readonly any[]): WorkflowState {
  let state = initialState();
  for (const entry of entries) if (entry.type === 'custom' && entry.customType === 'claude-compat:state' && entry.data?.version === 1) state = structuredClone(entry.data);
  return state;
}
