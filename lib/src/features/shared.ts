import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Runtime } from '../runtime/runtime.ts';
export type Feature = string;
interface Shared { runtime: Runtime; features: Set<Feature> }
// ExtensionAPI event facades differ, but all deliver through the same session bus.
const channel = 'pi-claude-compat:runtime:v2';
export function shared(pi: ExtensionAPI): Shared {
  let state: Shared | undefined;
  pi.events.emit(channel,{accept:(value:Shared)=>{state=value;}});
  if (state) { state.runtime.pi = pi; return state; }
  const runtime = new Runtime(pi); runtime.modular = true;
  state = {runtime,features:runtime.modularFeatures as Set<Feature>};
  const current = state;
  const unsubscribe = pi.events.on(channel,(request:any)=>request.accept(current));
  const features = state.features;
  const runHooks = runtime.hooks.run.bind(runtime.hooks);
  runtime.hooks.run = (...args) => features.has('hooks') ? runHooks(...args) : Promise.resolve({context:[]});
  pi.on('session_start',async (_e,ctx) => { await runtime.start(ctx); if (features.has('memory')) await runtime.memory.load(ctx.cwd); });
  pi.on('session_tree',async (_e,ctx) => { await runtime.start(ctx); if (features.has('memory')) await runtime.memory.load(ctx.cwd); });
  pi.on('session_shutdown',async (_e,ctx) => {
    if (runtime.ready) await runtime.hooks.run('SessionEnd',{},runtime.config,ctx.cwd);
    runtime.ready = false;
    if (_e.reason === 'reload' || _e.reason === 'quit') unsubscribe();
  });
  return state;
}

export function acquire(pi: ExtensionAPI, feature: string) { const state = shared(pi); if (state.features.has(feature)) return; state.features.add(feature); return state; }
