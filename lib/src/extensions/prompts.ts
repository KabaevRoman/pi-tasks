import { readFileSync } from 'node:fs';
import { hash } from '../runtime/utils.ts';
import { profile } from '../runtime/capabilities.ts';
export function render(template: string, bindings: Record<string, string>): string {
  // Expressions are opaque keys with explicit values, never executable JavaScript.
  return template.replace(/\$\{([^{}]+)\}/g, (_, key) => {
    if (!Object.hasOwn(bindings, key)) throw new Error(`Unresolved prompt binding: ${key}`);
    return bindings[key];
  });
}
export class PromptPack {
  readonly manifest: any;
  private originals = new Map<string, string>();
  constructor(root = new URL('../../prompts/', import.meta.url)) {
    this.manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
    if (this.manifest.commit !== profile.promptCommit) throw new Error('Prompt pack target mismatch');
    for (const entry of this.manifest.fragments) {
      if (!/^original\/[a-z0-9-]+\.md$/.test(entry.path)) throw new Error('Invalid prompt manifest path');
      const bytes = readFileSync(new URL(entry.path, root));
      if (hash(bytes) !== entry.sha256) throw new Error(`Prompt integrity failure: ${entry.path}`);
      this.originals.set(entry.path.slice(9), bytes.toString('utf8'));
    }
  }
  fragment(name: string, bindings: Record<string, string> = {}): string {
    const raw = this.originals.get(name); if (!raw) throw new Error(`Missing prompt: ${name}`);
    const result = render(raw.replace(/^<!--[\s\S]*?-->\s*/, ''), bindings);
    if (result.includes('${')) throw new Error(`Unresolved prompt expression: ${name}`);
    return result;
  }
  system(model: string, cwd: string, tools: string[], memory: string): string {
    return [
      `You are a coding assistant running in pi with a Claude Code ${profile.target} compatibility profile. Actual model: ${model}.`,
      'Help the user complete software engineering tasks. Read relevant code before editing. Make focused changes and verify the resulting behavior. Report outcomes truthfully and concisely.',
      this.fragment('system-prompt-system-section.md'),
      `Working directory: ${cwd}\nAvailable tools: ${tools.join(', ')}. Only claim capabilities of these tools.`,
      'This profile uses an incomplete pinned prompt pack. Subagents, hosted services, background jobs, and OS sandboxing are unavailable.',
      memory,
    ].filter(Boolean).join('\n\n');
  }
  description(name: string): string | undefined {
    if (name === 'Edit') return this.fragment('tool-description-edit.md', {
      'READ_BEFORE_EDIT_NOTE_FN()': '\n- Read the file before editing. A changed file must be read again.',
      LINE_NUMBER_PREFIX_FORMAT: 'line_number followed by a tab', ADDITIONAL_EDIT_GUIDELINES_NOTE: '',
    });
    // The original Read describes unsupported PDF/notebook rendering. Keep it inspectable;
    // a deliberately adapted description is registered instead of making false claims.
    return undefined;
  }
  inspect() { return { manifest: this.manifest, slots: { system: ['local identity/environment adaptation', 'system-prompt-system-section.md', 'project memory'], Edit: 'tool-description-edit.md' }, patches: ['Main instruction stack is an approximation; full inventory is unavailable.', 'Read uses local text-only description; PDF/notebook rendering is unsupported.', 'Agent/compaction/plan fragments are archived but inactive until their capabilities are validated.'] }; }
}
