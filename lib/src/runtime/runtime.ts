import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { Check } from 'typebox/value';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Approvals } from './approvals.ts';
import { Scheduler } from './scheduler.ts';
import { loadConfig, type Settings } from './config.ts';
import { initialState, restore, type WorkflowState } from './state.ts';
import { canonical, hash, textResult } from './utils.ts';
import { PromptPack } from '../extensions/prompts.ts';
import { Memory } from '../extensions/memory.ts';
import { Hooks } from '../extensions/hooks.ts';
import { decide } from '../extensions/permissions.ts';
export class Runtime {
  pi: ExtensionAPI;
  modular = false;
  modularFeatures = new Set<string>();
  readonly scheduler = new Scheduler();
  readonly approvals = new Approvals();
  readonly prompts = new PromptPack();
  readonly memory = new Memory();
  readonly hooks = new Hooks();
  readonly tools = new Set<string>();
  readonly readVersions = new Map<string, string>();
  state: WorkflowState = initialState();
  config!: Settings;
  cwd = '';
  store = '';
  ready = false;
  constructor(pi: ExtensionAPI) { this.pi = pi; }
  async start(ctx: ExtensionContext): Promise<void> {
    this.ready = false; this.cwd = ctx.cwd;
    this.state = restore(ctx.sessionManager.getBranch());
    this.readVersions.clear();
    this.store = join(homedir(), '.local/share/pi-claude-compat', hash(ctx.cwd).slice(0,24), hash(ctx.sessionManager.getSessionId()).slice(0,24));
    await this.reload(ctx);
    if (!this.modular) {
    const ownPath = await canonical(fileURLToPath(new URL('../index.ts', import.meta.url)));
    const registered = this.pi.getAllTools();
    for (const name of this.tools) {
      const tool = registered.find(t => t.name === name);
      if (!tool || ![ownPath, await canonical(fileURLToPath(new URL('../strict.ts', import.meta.url)))].includes(await canonical(tool.sourceInfo.path))) throw new Error(`Tool ownership conflict: ${name}. Disable the conflicting extension.`);
    }
    }
    if (!ctx.sessionManager.getBranch().some((e: any) => e.customType === 'claude-compat:state')) this.state.mode = this.config.permissions.defaultMode ?? 'default';
    if (!this.modular) await this.memory.load(ctx.cwd);
    if (!this.modular) this.pi.setActiveTools([...this.tools]);
    const startup = await this.hooks.run('SessionStart', { source: 'startup', session_id: ctx.sessionManager.getSessionId() }, this.config, this.cwd, ctx.signal);
    if (startup.deny) throw new Error(startup.deny);
    this.ready = true; this.status(ctx);
  }
  async reload(ctx: ExtensionContext): Promise<void> { this.config = await loadConfig(ctx.cwd, ctx.isProjectTrusted()); }
  persist(): void { this.pi.appendEntry('claude-compat:state', structuredClone(this.state)); }
  status(ctx: ExtensionContext): void { ctx.ui.setStatus('claude-compat', `CC ${this.state.mode} · ${Object.values(this.state.tasks).filter(t => t.status !== 'completed').length} tasks`); }
  message(content: string): void { this.pi.sendMessage({ customType: 'claude-compat', content, display: true }); }
  register(schema: TSchema, name: string, description: string, write: boolean, backend: (input: any, ctx: ExtensionContext, signal?: AbortSignal) => Promise<ReturnType<typeof textResult>>): void {
    this.tools.add(name);
    const tool: ToolDefinition<any, any> = {
      name, label: name, description, parameters: schema, executionMode: write ? 'sequential' : 'parallel',
      execute: async (_id, raw, signal, _update, ctx) => this.scheduler.run(write, async () => {
        if (!this.ready) throw new Error('Compatibility runtime is unavailable; inspect /compat diagnostics');
        let input: any = structuredClone(raw);
        if (!Check(schema, input)) throw new Error(`Invalid ${name} input`);
        await this.reload(ctx);
        const payload = { session_id: ctx.sessionManager.getSessionId(), tool_name: name, tool_input: input, tool_use_id: _id };
        try {
          const pre = await this.hooks.run('PreToolUse', payload, this.config, ctx.cwd, signal);
          if (pre.deny) throw new Error(pre.deny);
          if (pre.updatedInput) input = structuredClone(pre.updatedInput);
          if (!Check(schema, input)) throw new Error(`Hook rewrite failed ${name} schema validation`);
          const resolveTarget = async (): Promise<string | undefined> => {
            if (typeof input.notebook_path === 'string') return canonical(input.notebook_path);
            if (typeof input.file_path === 'string') {
              if (!isAbsolute(input.file_path)) throw new Error('file_path must be an absolute path');
              return canonical(input.file_path);
            }
            if (typeof input.path === 'string') return canonical(resolve(ctx.cwd, input.path));
            return undefined;
          };
          payload.tool_input = input;
          let target = await resolveTarget();
          let decision = await decide(name, input as Record<string, any>, this.state.mode, this.config, ctx.cwd, this.state.plan?.path);
          if (decision.action === 'deny') throw new Error(decision.reason);
          if (decision.action === 'ask') {
            const permissionHook = await this.hooks.run('PermissionRequest', payload, this.config, ctx.cwd, signal);
            if (permissionHook.deny) throw new Error(permissionHook.deny);
            if (permissionHook.updatedInput) {
              input = structuredClone(permissionHook.updatedInput);
              if (!Check(schema, input)) throw new Error('Invalid permission hook rewrite');
              payload.tool_input = input;
              target = await resolveTarget();
            }
            await this.reload(ctx);
            decision = await decide(name, input as Record<string, any>, this.state.mode, this.config, ctx.cwd, this.state.plan?.path);
          }
          const policyFingerprint = JSON.stringify(this.config.permissions);
          if (decision.action === 'deny') throw new Error(decision.reason);
          if (decision.action === 'ask' && !await this.approvals.request(ctx, `${name}: ${decision.reason}`, JSON.stringify(input), signal)) throw new Error('Permission denied or approval UI unavailable');
          signal?.throwIfAborted();
          await this.reload(ctx);
          if (policyFingerprint !== JSON.stringify(this.config.permissions)) throw new Error('Permissions changed during approval; retry the tool');
          const current = await decide(name, input as Record<string, any>, this.state.mode, this.config, ctx.cwd, this.state.plan?.path);
          if (target !== await resolveTarget()) throw new Error('Resolved tool path changed during approval');
          if (current.action === 'deny') throw new Error('Policy changed before execution');
          const result = await backend(input, ctx, signal);
          // Post hooks cannot turn an already successful filesystem operation into a failure.
          try {
            const post = await this.hooks.run('PostToolUse', { ...payload, tool_response: result }, this.config, ctx.cwd, signal);
            for (const context of [...pre.context, ...post.context]) result.content.push({ type: 'text', text: context });
          } catch (error) { result.content.push({ type: 'text', text: `PostToolUse hook error: ${String(error)}` }); }
          this.status(ctx); return result;
        } catch (error) {
          try { await this.hooks.run('PostToolUseFailure', { ...payload, error: String(error) }, this.config, ctx.cwd, signal); } catch {}
          throw error;
        }
      }, signal),
    };
    this.pi.registerTool(tool);
  }
  artifact(kind: string): string { return join(this.store, kind, randomUUID()); }
}
