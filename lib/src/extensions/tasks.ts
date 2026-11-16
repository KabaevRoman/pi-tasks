import { Type } from 'typebox';
import type { Runtime } from 'pi-code-core/runtime/runtime';
import type { Task } from 'pi-code-core/runtime/state';
import { object } from 'pi-code-core/runtime/schema';
import { textResult } from 'pi-code-core/runtime/utils';
const id = () => Type.String({ pattern: '^[1-9][0-9]*$' });
const status = () => Type.Union([Type.Literal('pending'),Type.Literal('in_progress'),Type.Literal('completed')]);
export function validateGraph(tasks: Record<string, Task>): void {
  const active = new Set<string>(), done = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) throw new Error('Task dependencies would create a cycle');
    if (done.has(id)) return; active.add(id);
    for (const dep of tasks[id].blockedBy) { if (!tasks[dep]) throw new Error(`Unknown dependency: ${dep}`); visit(dep); }
    active.delete(id); done.add(id);
  }
  for (const id of Object.keys(tasks)) visit(id);
}
export function registerTasks(runtime: Runtime): void {
  runtime.register(object({todos:Type.Array(object({content:Type.String({minLength:1}),activeForm:Type.String(),status:status()}),{maxItems:100})}),'TodoWrite','Replace the current todo list with durable task items. Existing dependency graphs are replaced explicitly.',true,async input=>{
    const tasks:Record<string,Task>={};
    for(const todo of input.todos){const id=String(runtime.state.nextTask++);tasks[id]={id,subject:todo.content,description:todo.content,activeForm:todo.activeForm,status:todo.status,blockedBy:[],blocks:[]};}
    runtime.state.tasks=tasks;runtime.persist();return textResult(JSON.stringify({todos:input.todos}),{tasks});
  });
  runtime.register(object({ subject: Type.String({ minLength: 1 }), description: Type.String(), activeForm: Type.Optional(Type.String()), metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }), 'TaskCreate', 'Create a durable session-branch work item. Work items are distinct from processes and subagents.', true, async input => {
    const id = String(runtime.state.nextTask++);
    const task: Task = { ...input, id, status: 'pending', blockedBy: [], blocks: [] };
    runtime.state.tasks[id] = task; runtime.persist();
    return textResult(JSON.stringify({ task }), { task });
  });
  runtime.register(object({ taskId: id() }), 'TaskGet', 'Get a task by ID, including dependencies and status.', false, async input => {
    const task = runtime.state.tasks[input.taskId]; if (!task) throw new Error('Task not found');
    return textResult(JSON.stringify({ task }), { task });
  });
  runtime.register(object({}), 'TaskList', 'List work items in the active session branch.', false, async () => {
    const tasks = Object.values(runtime.state.tasks);
    return textResult(JSON.stringify({ tasks }), { tasks });
  });
  runtime.register(object({ taskId: id(), subject: Type.Optional(Type.String({ minLength: 1 })), description: Type.Optional(Type.String()), activeForm: Type.Optional(Type.String()), status: Type.Optional(Type.Union([status(),Type.Literal('deleted')])), owner: Type.Optional(Type.String()), addBlockedBy: Type.Optional(Type.Array(id())), addBlocks: Type.Optional(Type.Array(id())), metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }), 'TaskUpdate', 'Update a work item. Dependencies must exist and remain acyclic. Blocked tasks cannot start or complete.', true, async (input, ctx, signal) => {
    const tasks = structuredClone(runtime.state.tasks), task = tasks[input.taskId]; if (!task) throw new Error('Task not found');
    const oldStatus = task.status;
    if(input.status==='deleted') {
      delete tasks[task.id];
      for(const item of Object.values(tasks)){item.blocks=item.blocks.filter(id=>id!==task.id);item.blockedBy=item.blockedBy.filter(id=>id!==task.id);}
      runtime.state.tasks=tasks;runtime.persist();return textResult(JSON.stringify({deleted:task.id}),{deleted:task.id});
    }
    if(input.metadata)input.metadata={...(task.metadata??{}),...input.metadata};
    for (const key of ['subject','description','activeForm','status','owner','metadata'] as const) if (input[key] !== undefined) (task as any)[key] = input[key];
    for (const dep of input.addBlockedBy ?? []) { if (!tasks[dep]) throw new Error(`Unknown dependency: ${dep}`); task.blockedBy = [...new Set([...task.blockedBy,dep])]; tasks[dep].blocks = [...new Set([...tasks[dep].blocks,task.id])]; }
    for (const child of input.addBlocks ?? []) { if (!tasks[child]) throw new Error(`Unknown dependency: ${child}`); task.blocks = [...new Set([...task.blocks,child])]; tasks[child].blockedBy = [...new Set([...tasks[child].blockedBy,task.id])]; }
    validateGraph(tasks);
    for (const item of Object.values(tasks)) if (item.status !== 'pending' && item.blockedBy.some(dep => tasks[dep].status !== 'completed')) throw new Error('Blocked tasks cannot start or complete');
    if (task.status === 'completed' && oldStatus !== 'completed') {
      const outcome = await runtime.hooks.run('TaskCompleted', { task_id: task.id, task_subject: task.subject }, runtime.config, ctx.cwd, signal);
      if (outcome.deny) throw new Error(outcome.deny);
    }
    runtime.state.tasks = tasks; runtime.persist();
    return textResult(JSON.stringify({ task }), { task });
  });
}
