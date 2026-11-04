import { member, parseJson, type ComposerRequest } from './language/plugins/composer';

// Resultados das consultas em segundo plano (`composerCheck`) projetados sobre o composer.json:
// ícone de atualização no gutter (PhpStorm: "Update Package", via `update --dry-run`), avisos de
// segurança do `composer audit` e as ações do ⌥Enter. Funções puras, sem Monaco, para teste.

export type PackageUpdate = { name: string; from: string; to: string; downgrade: boolean };
export type Advisory = { name: string; id: string; title: string; cve?: string | null; link?: string | null; affected: string; severity?: string | null };
export type Abandoned = { name: string; replacement?: string | null };
export type AuditResult = { advisories: Advisory[]; abandoned: Abandoned[] };
export type OutdatedPackage = { name: string; version: string; latest: string; status: string; description: string; abandoned: boolean };
export type Insights = { updates?: PackageUpdate[]; audit?: AuditResult; outdated?: OutdatedPackage[] };

/** Dependência declarada em `require`/`require-dev`, com a posição da chave (offsets). */
export type Dependency = { name: string; section: 'require' | 'require-dev'; constraint: string; keyStart: number; keyEnd: number };
export function dependencies(text: string): Dependency[] {
 let root; try { root = parseJson(text); } catch { return []; }
 const out: Dependency[] = [];
 for (const section of ['require', 'require-dev'] as const) {
  const node = member(root, section)?.value;
  if (node?.type === 'object') for (const e of node.entries) out.push({ name: e.key, section, constraint: e.value.type === 'string' ? e.value.value : '', keyStart: e.keyStart, keyEnd: e.keyEnd });
 }
 return out;
}
export function scriptKeys(text: string): { name: string; keyStart: number; keyEnd: number }[] {
 try { const node = member(parseJson(text), 'scripts')?.value; return node?.type === 'object' ? node.entries.map(e => ({ name: e.key, keyStart: e.keyStart, keyEnd: e.keyEnd })) : []; } catch { return []; }
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Dicas de atualização só para dependências diretas, como o gutter do PhpStorm. */
export function updateHints(text: string, updates: PackageUpdate[] = []) {
 return dependencies(text).flatMap(d => { const u = updates.find(x => same(x.name, d.name) && !x.downgrade); return u ? [{ ...d, from: u.from, to: u.to }] : []; });
}

export type Problem = { keyStart: number; keyEnd: number; message: string; code: 'composer.vulnerable' | 'composer.vulnerable-indirect' | 'composer.abandoned'; severity: 'warning' | 'error'; name: string; link?: string };
/** Marcadores do `composer audit`: na chave da dependência direta; indiretas num só aviso na seção `require`. */
export function auditProblems(text: string, audit?: AuditResult): Problem[] {
 if (!audit) return [];
 const deps = dependencies(text); const out: Problem[] = [];
 const groups = new Map<string, Advisory[]>();
 for (const a of audit.advisories) groups.set(a.name.toLowerCase(), [...(groups.get(a.name.toLowerCase()) ?? []), a]);
 const indirect: string[] = [];
 for (const [name, list] of groups) {
  const dep = deps.find(d => same(d.name, name));
  if (!dep) { indirect.push(`${list[0].name} (${list.length})`); continue; }
  const high = list.some(a => /^(high|critical)$/i.test(a.severity ?? ''));
  const lines = list.slice(0, 5).map(a => `${a.cve || a.id}${a.severity ? ` [${a.severity}]` : ''}: ${a.title}`);
  out.push({ keyStart: dep.keyStart, keyEnd: dep.keyEnd, name: dep.name, code: 'composer.vulnerable', severity: high ? 'error' : 'warning', link: list[0].link ?? undefined,
   message: `${dep.name} tem ${list.length} aviso(s) de segurança na versão travada (composer audit):\n${lines.join('\n')}${list.length > 5 ? `\n… e mais ${list.length - 5}` : ''}` });
 }
 const anchor = deps.find(d => d.section === 'require') ?? deps[0];
 if (indirect.length && anchor) out.push({ keyStart: anchor.keyStart, keyEnd: anchor.keyEnd, name: anchor.name, code: 'composer.vulnerable-indirect', severity: 'warning', message: `Dependências indiretas com avisos de segurança: ${indirect.join(', ')}. Veja a janela Composer → Audit.` });
 for (const a of audit.abandoned) {
  const dep = deps.find(d => same(d.name, a.name)); if (!dep) continue;
  out.push({ keyStart: dep.keyStart, keyEnd: dep.keyEnd, name: dep.name, code: 'composer.abandoned', severity: 'warning', message: `${dep.name} foi abandonado${a.replacement ? `; use ${a.replacement}` : ''}.` });
 }
 return out;
}

/** Ação do ⌥Enter: `request` roda no Composer; `preferred` vira a primeira da lista. */
export type QuickFix = { title: string; request: ComposerRequest; kind: 'quickfix' | 'refactor'; codes?: string[]; preferred?: boolean };
/**
 * Ações disponíveis em `offset`. `markers` são os códigos dos diagnósticos sob o cursor
 * (do plugin de linguagem: `composer.not-installed`, `composer.package-not-locked`, `composer.lock-outdated`).
 */
export function quickFixes(text: string, offset: number, markers: string[], insights: Insights = {}): QuickFix[] {
 const out: QuickFix[] = [];
 const has = (code: string) => markers.filter(m => m === code || m.endsWith('/' + code));
 const dep = dependencies(text).find(d => offset >= d.keyStart && offset <= d.keyEnd);
 const platform = (name: string) => !name.includes('/');
 if (dep && !platform(dep.name)) {
  const missing = [...has('composer.not-installed'), ...has('composer.package-not-locked')];
  if (missing.length) {
   out.push({ title: `Instalar ${dep.name}`, request: { action: 'update', packages: [dep.name] }, kind: 'quickfix', codes: missing, preferred: true });
   out.push({ title: has('composer.not-installed').length ? 'Instalar todos os pacotes (composer install)' : 'Instalar todos os pacotes (composer update)', request: { action: has('composer.not-installed').length ? 'install' : 'update' }, kind: 'quickfix', codes: missing });
  }
  const vulnerable = has('composer.vulnerable');
  const hint = (insights.updates ?? []).find(u => same(u.name, dep.name) && !u.downgrade);
  if (vulnerable.length) out.push({ title: hint ? `Atualizar ${dep.name} para ${hint.to} (corrige avisos de segurança)` : `Atualizar ${dep.name} (avisos de segurança)`, request: { action: 'update', packages: [dep.name] }, kind: 'quickfix', codes: vulnerable, preferred: !missing.length });
  else if (hint) out.push({ title: `Atualizar ${dep.name} para ${hint.to}`, request: { action: 'update', packages: [dep.name] }, kind: 'quickfix', preferred: !missing.length });
  if (hint && (insights.updates?.length ?? 0) > 1) out.push({ title: 'Atualizar todos os pacotes', request: { action: 'update' }, kind: 'quickfix' });
  out.push({ title: `Mostrar por que ${dep.name} está instalado (composer why)`, request: { action: 'why', packages: [dep.name] }, kind: 'refactor' });
 }
 const lock = has('composer.lock-outdated');
 if (lock.length) {
  out.push({ title: 'Atualizar o hash do composer.lock (composer update --lock)', request: { action: 'update', lock: true }, kind: 'quickfix', codes: lock, preferred: !out.some(f => f.preferred) });
  out.push({ title: 'Atualizar dependências (composer update)', request: { action: 'update' }, kind: 'quickfix', codes: lock });
 }
 const script = scriptKeys(text).find(s => offset >= s.keyStart && offset <= s.keyEnd);
 if (script) out.push({ title: `Executar '${script.name}'`, request: { action: 'run-script', script: script.name }, kind: 'refactor' });
 return out;
}

/** Linha de resumo das consultas, mostrada na janela Composer. */
export function insightSummary(insights: Insights): string {
 const parts: string[] = [];
 if (insights.updates) parts.push(insights.updates.length ? `${insights.updates.length} atualização(ões) disponível(is)` : 'dependências atualizadas');
 if (insights.audit) { const n = new Set(insights.audit.advisories.map(a => a.name.toLowerCase())).size; parts.push(n ? `${insights.audit.advisories.length} aviso(s) de segurança em ${n} pacote(s)` : 'nenhum aviso de segurança'); if (insights.audit.abandoned.length) parts.push(`${insights.audit.abandoned.length} abandonado(s)`); }
 if (insights.outdated) parts.push(insights.outdated.length ? `${insights.outdated.length} desatualizado(s)` : 'nenhum desatualizado');
 return parts.join(' · ');
}
