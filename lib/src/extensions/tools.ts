import { Type } from 'typebox';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve, matchesGlob, relative } from 'node:path';
import type { Runtime } from '../runtime/runtime.ts';
import { canonical, hash, optionalText, textResult } from '../runtime/utils.ts';
import { trackedWrite } from './checkpoints.ts';
import { runProcess } from '../backends/process.ts';
export const object = (properties: any) => Type.Object(properties, { additionalProperties: false });
const str = () => Type.String({ minLength: 1 });
const optionalInt = (minimum: number, maximum: number) => Type.Optional(Type.Integer({ minimum, maximum }));
async function filePath(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('file_path must be an absolute path');
  return canonical(path);
}
async function readText(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('Expected a regular file');
  if (info.size > 4_000_000) throw new Error('File exceeds 4 MB text limit');
  const bytes = await readFile(path);
  if (bytes.includes(0)) throw new Error('Binary, PDF, and notebook rendering are unsupported');
  return bytes.toString('utf8');
}
export function registerTools(runtime: Runtime): void {
  runtime.register(object({ file_path: str(), offset: optionalInt(1, Number.MAX_SAFE_INTEGER), limit: optionalInt(1, 2000) }), 'Read', 'Read UTF-8 text with 1-based line numbers. file_path must be absolute. Default 2000 lines. Binary/PDF/notebook rendering is unsupported.', false, async (input) => {
    const path = await filePath(input.file_path), text = await readText(path);
    runtime.readVersions.set(path, hash(text));
    const offset = input.offset ?? 1, limit = input.limit ?? 2000;
    const lines = text.split('\n'); if (text.endsWith('\n')) lines.pop();
    let output = lines.slice(offset - 1, offset - 1 + limit).map((line, i) => `${offset + i}\t${line.length > 2000 ? line.slice(0,2000) + '…' : line}`).join('\n');
    if (!text) output = '<system-reminder>The file exists but is empty.</system-reminder>';
    if (output.length > 64_000) output = output.slice(0,64_000) + '\n[Output truncated; use offset/limit.]';
    const discovered = await runtime.memory.descendant(path);
    if (discovered.length) output += '\n\n' + runtime.memory.format(discovered);
    return textResult(output, { path, offset, totalLines: lines.length, hash: hash(text) });
  });
  runtime.register(object({ file_path: str(), content: Type.String() }), 'Write', 'Write UTF-8 text to an absolute file_path. Existing files must have been read and must be unchanged since that read. Creates a rewind checkpoint.', true, async input => {
    const path = await filePath(input.file_path), before = await optionalText(path);
    if (before !== undefined && runtime.readVersions.get(path) !== hash(before)) throw new Error('Read the current file before overwriting it; it is unread or changed');
    await trackedWrite(runtime, path, input.content);
    return textResult(`Wrote ${path}`, { path, bytes: Buffer.byteLength(input.content) });
  });
  runtime.register(object({ file_path: str(), old_string: str(), new_string: Type.String(), replace_all: Type.Optional(Type.Boolean()) }), 'Edit', runtime.prompts.description('Edit')!, true, async input => {
    const path = await filePath(input.file_path), before = await readText(path);
    if (runtime.readVersions.get(path) !== hash(before)) throw new Error('Read the current file before editing it; it is unread or changed');
    if (input.old_string === input.new_string) throw new Error('old_string and new_string must differ');
    const count = before.split(input.old_string).length - 1;
    if (!count) throw new Error('old_string was not found');
    if (count > 1 && !input.replace_all) throw new Error(`old_string occurs ${count} times; provide more context or replace_all`);
    const after = input.replace_all ? before.split(input.old_string).join(input.new_string) : before.replace(input.old_string, () => input.new_string);
    await trackedWrite(runtime, path, after);
    return textResult(`Edited ${path} (${input.replace_all ? count : 1} replacement${count === 1 ? '' : 's'})`, { path, replacements: input.replace_all ? count : 1 });
  });
  runtime.register(object({ pattern: str(), path: Type.Optional(str()) }), 'Glob', 'Find files using ripgrep glob syntax. Respects ignore files, includes hidden files except .git, never follows directory symlinks. Returns at most 1000 sorted paths.', false, async (input, ctx, signal) => {
    const root = resolve(ctx.cwd, input.path ?? '.');
    const result = await runProcess('rg', ['--files','--hidden','--sort','path','-g','!.git/**','--', root], { cwd: ctx.cwd, signal });
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(result.output);
    return textResult(result.output.trim().split('\n').filter((file: string) => file && matchesGlob(relative(root,file),input.pattern)).sort().slice(0,1000).join('\n'), { truncated: result.truncated });
  });
  runtime.register(object({ pattern: str(), path: Type.Optional(str()), glob: Type.Optional(str()), output_mode: Type.Optional(Type.Union([Type.Literal('content'),Type.Literal('files_with_matches'),Type.Literal('count')])), '-i': Type.Optional(Type.Boolean()), '-n': Type.Optional(Type.Boolean()), head_limit: optionalInt(1,2000) }), 'Grep', 'Search text using ripgrep regex syntax. Respects ignore files, includes hidden files except .git. output_mode: content, files_with_matches (default), count. Results are bounded.', false, async (input, ctx, signal) => {
    const args = ['--hidden','-g','!.git/**','--color','never'];
    const mode = input.output_mode ?? 'files_with_matches';
    if (mode === 'files_with_matches') args.push('-l'); else if (mode === 'count') args.push('-c'); else if (input['-n'] !== false) args.push('-n');
    if (input['-i']) args.push('-i'); if (input.glob) args.push('-g',input.glob);
    args.push('-e',input.pattern,'--',resolve(ctx.cwd, input.path ?? '.'));
    const result = await runProcess('rg', args, { cwd: ctx.cwd, signal });
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(result.output);
    return textResult(result.output.split('\n').slice(0,input.head_limit ?? 200).join('\n'), { truncated: result.truncated });
  });
  runtime.register(object({ command: str(), timeout: optionalInt(1,600_000), description: Type.Optional(Type.String()) }), 'Bash', 'Execute a foreground Bash command in the session cwd. timeout is in milliseconds, maximum 600000. Output is bounded and stored in an output artifact. Commands require approval or an explicit permission rule. No sandbox/background execution.', true, async (input, ctx, signal) => {
    const result = await runProcess('/bin/bash', ['-c',input.command], { cwd: ctx.cwd, signal, timeout: input.timeout, outputPath: runtime.artifact('outputs') });
    if (result.cancelled) throw new Error(`Command cancelled; output: ${result.outputPath}`);
    return textResult(`${result.output}\n[exit: ${result.exitCode}${result.timedOut ? '; timed out' : ''}${result.truncated ? '; output truncated' : ''}]\nOutput artifact: ${result.outputPath}`, { ...result });
  });
}
