import type { ComposerRequest } from './language/plugins/composer';

// Composer Log (PhpStorm: console "Composer Log" na janela Run, aberta por "Show log"): cada
// comando executado pela IDE vira uma entrada com a linha de comando, a saída e ▶ para repetir.
// Execuções bem-sucedidas ficam dobradas; falhas ficam abertas. Modelo puro, sem DOM, para teste.

export type LogState = 'running' | 'passed' | 'failed' | 'cancelled';
export type LogEntry = { id: string; command: string; request: ComposerRequest; startedAt: number; state: LogState; output: string; durationMs?: number; exitCode?: number | null; folded: boolean; note?: string };
const MAX_ENTRIES = 100; const MAX_OUTPUT = 200_000;

/** Argumentos como o PhpStorm mostra no log (`update psr/log --no-interaction`), sem o executável. */
export function logCommand(command: string, request: ComposerRequest): string {
 const words = command.trim().split(/\s+/).filter(Boolean);
 const at = words.findIndex(w => /(^|[/\\])composer(\.phar|\.bat|\.exe)?$/i.test(w.replace(/^['"]|['"]$/g, '')));
 if (at >= 0 && at < words.length - 1) return words.slice(at + 1).join(' ');
 return [request.action, request.dev ? '--dev' : '', request.lock ? '--lock' : '', request.optimize ? '--optimize' : '', request.script ?? '', ...(request.packages ?? [])].filter(Boolean).join(' ');
}

export class ComposerLog {
 entries: LogEntry[] = [];
 start(id: string, command: string, request: ComposerRequest, now = Date.now()): LogEntry {
  const entry: LogEntry = { id, command, request, startedAt: now, state: 'running', output: '', folded: false };
  this.entries.push(entry); if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
  return entry;
 }
 get(id: string) { return this.entries.find(e => e.id === id); }
 append(id: string, text: string) { const e = this.get(id); if (e && e.state === 'running') e.output = (e.output + text).slice(-MAX_OUTPUT); return e; }
 /** Resultado final: a saída completa substitui a parcial; sucesso dobra a entrada. */
 finish(id: string, result: { command?: string; output?: string; exitCode?: number | null; cancelled?: boolean; timedOut?: boolean; durationMs?: number; error?: string }) {
  const e = this.get(id); if (!e) return undefined;
  if (result.command) e.command = logCommand(result.command, e.request);
  if (result.output) e.output = result.output.slice(-MAX_OUTPUT);
  if (result.error) e.output += (e.output && !e.output.endsWith('\n') ? '\n' : '') + result.error + '\n';
  e.durationMs = result.durationMs; e.exitCode = result.exitCode;
  e.state = result.cancelled || result.timedOut ? 'cancelled' : result.error || (result.exitCode ?? 1) !== 0 ? 'failed' : 'passed';
  if (result.timedOut) e.note = 'tempo limite';
  e.folded = e.state === 'passed';
  return e;
 }
 toggle(id: string) { const e = this.get(id); if (e) e.folded = !e.folded; return e; }
 clear() { this.entries = this.entries.filter(e => e.state === 'running'); }
}

/** Resumo da entrada dobrada (o "…" do PhpStorm): primeiras linhas significativas da saída. */
export function foldPreview(entry: LogEntry, lines = 6) {
 return entry.output.split('\n').map(l => l.trimEnd()).filter(Boolean).slice(0, lines).join('\n');
}
/** Trechos da saída com referências clicáveis a composer.json/composer.lock (`./composer.json`). */
export function linkify(text: string): { text: string; path?: string }[] {
 const out: { text: string; path?: string }[] = []; let last = 0;
 for (const m of text.matchAll(/(?<![\w/.-])(?:\.\/)?(composer\.(?:json|lock))(?![\w-]|\.\w)/g)) {
  if (m.index! > last) out.push({ text: text.slice(last, m.index) });
  out.push({ text: m[0], path: m[1] }); last = m.index! + m[0].length;
 }
 if (last < text.length) out.push({ text: text.slice(last) });
 return out;
}
