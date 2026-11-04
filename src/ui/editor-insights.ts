import { auditProblems, lockVersions, quickFixes, updateHints, versionHints, type AuditResult, type Insights, type OutdatedPackage, type PackageUpdate } from '../shared/composer-insights';
import type { ComposerRequest } from '../shared/language/plugins/composer';

// composer.json no editor: ícone "Update Package" no gutter para dependências diretas com versão
// mais nova dentro da restrição (PhpStorm: `update --dry-run` ao abrir o projeto ou mudar o arquivo;
// clique atualiza), marcadores do `composer audit` e ações do ⌥Enter.

export type CheckKind = 'updates' | 'audit' | 'outdated';
type Options = {
 monaco: any; editor: any; api: any; keymap: any; own(v: unknown): unknown; tr(s: string): string;
 run(request: ComposerRequest): Promise<void>; runner(): unknown; enabled(): { updates: boolean; audit: boolean };
 busy(): boolean; changed(insights: Insights, state: { running: CheckKind[]; errors: Partial<Record<CheckKind, string>> }): void;
};
const OWNER = 'composer-audit';

export function mountEditorInsights(o: Options) {
 const { monaco, editor } = o;
 let root = ''; void o.api.workspace().then((w: { root: string }) => { root = w.root.replace(/\\/g, '/').replace(/\/$/, ''); schedule(0); }).catch(() => {});
 const insights: Insights = {}; const errors: Partial<Record<CheckKind, string>> = {}; const running = new Set<CheckKind>();
 let epoch = 0; let timer: ReturnType<typeof setTimeout> | undefined; let pending = false;
 const isComposerJson = (model: any) => !!model && !model.isDisposed?.() && model.uri?.scheme === 'file' && (root ? model.uri.path === root + '/composer.json' || model.uri.fsPath?.replace(/\\/g, '/') === root + '/composer.json' : /\/composer\.json$/.test(model.uri.path) && !/\/vendor\//.test(model.uri.path));
 const models = () => monaco.editor.getModels().filter(isComposerJson);
 const notify = () => o.changed(insights, { running: [...running], errors: { ...errors } });

 async function check(kinds: CheckKind[]) {
  const token = epoch;
  for (const kind of kinds) {
   if (running.has(kind)) continue;
   running.add(kind); delete errors[kind]; notify();
   try {
    const out = await o.api.composerCheck(kind, o.runner());
    if (token !== epoch) return;
    if (kind === 'updates') insights.updates = out.result as PackageUpdate[];
    else if (kind === 'audit') insights.audit = out.result as AuditResult;
    else insights.outdated = out.result as OutdatedPackage[];
   } catch (error) {
    if (token !== epoch) return;
    errors[kind] = String((error as Error)?.message ?? error);
   } finally { running.delete(kind); if (token === epoch) { render(); notify(); } }
  }
 }
 /** Consulta automática: só com o composer.json aberto e sem Composer em execução (o lock pode estar mudando). */
 function schedule(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => {
   if (!models().length) return;
   if (o.busy()) { pending = true; return; }
   const { updates, audit } = o.enabled(); const kinds: CheckKind[] = [];
   if (updates) kinds.push('updates'); if (audit) kinds.push('audit');
   if (kinds.length) void check(kinds);
  }, delay);
 }

 const decorations = new Map<any, any>();
 // composer.lock lido para as versões instaladas nos inlays (relido quando o lock muda).
 let locked = new Map<string, string>();
 async function readLock() { try { locked = lockVersions((await o.api.read('composer.lock')).text); } catch { locked = new Map(); } render(); }
 void readLock();
 const kindLabel: Record<string, string> = { major: 'atualização major', minor: 'atualização minor', patch: 'atualização de patch', other: 'atualização' };
 function render() {
  for (const model of monaco.editor.getModels()) {
   if (!isComposerJson(model)) continue;
   const text = model.getValue(); const at = (offset: number) => model.getPositionAt(offset);
   monaco.editor.setModelMarkers(model, OWNER, auditProblems(text, insights.audit).map(p => {
    const s = at(p.keyStart), e = at(p.keyEnd);
    return { severity: p.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: p.message, code: p.link ? { value: p.code, target: monaco.Uri.parse(p.link) } : p.code, source: 'Composer audit', startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column };
   }));
  }
  for (const ed of monaco.editor.getEditors?.() ?? [editor]) {
   const model = ed.getModel(); let collection = decorations.get(ed);
   if (!collection) { collection = ed.createDecorationsCollection(); decorations.set(ed, collection); }
   if (!isComposerJson(model)) { collection.clear(); continue; }
   const text = model.getValue();
   // Mesmo ícone para patch/minor/major (observado no PhpStorm 2026.1); o tipo vai no hover e em data-kind.
   const glyphs = updateHints(text, insights.updates).map(h => {
    const line = model.getPositionAt(h.keyStart).lineNumber;
    return { range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: `composer-update-glyph composer-update-${h.kind}`, glyphMarginHoverMessage: { value: `**${h.name}** ${h.from} → ${h.to} (${o.tr(kindLabel[h.kind])})\n\n${o.tr('Atualização disponível. Clique para atualizar (composer update).')}` }, stickiness: 1 } };
   });
   const inlays = versionHints(text, locked, insights.updates).map(h => {
    const p = model.getPositionAt(h.offset);
    return { range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), options: { after: { content: h.label, inlineClassName: `composer-version-hint${h.kind ? ' composer-version-update' : ''}`, inlineClassNameAffectsLetterSpacing: true }, showIfCollapsed: true, stickiness: 1 } };
   });
   collection.set([...glyphs, ...inlays]);
  }
 }
 const hintAt = (model: any, line: number) => updateHints(model.getValue(), insights.updates).find(h => model.getPositionAt(h.keyStart).lineNumber === line);
 o.own(editor.onMouseDown((event: any) => {
  if (event.target?.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
  const model = editor.getModel(); if (!isComposerJson(model)) return;
  const hint = hintAt(model, event.target.position?.lineNumber ?? 0); if (!hint) return;
  event.event?.preventDefault?.(); void o.run({ action: 'update', packages: [hint.name] });
 }));
 o.own(editor.onDidChangeModel(() => { render(); if (isComposerJson(editor.getModel())) schedule(300); }));
 o.own(monaco.editor.onDidCreateModel((model: any) => { if (isComposerJson(model)) schedule(300); }));

 // ⌥Enter: correções dos diagnósticos (plugin de linguagem e audit) e intenções da linha.
 o.own(monaco.editor.registerCommand('phpforge.composer.run', (_accessor: unknown, request: ComposerRequest) => { void o.run(request); }));
 o.own(monaco.languages.registerCodeActionProvider('json', {
  provideCodeActions(model: any, range: any, context: any) {
   if (!isComposerJson(model)) return { actions: [], dispose() {} };
   const code = (m: any) => String(typeof m.code === 'object' ? m.code?.value : m.code ?? '');
   const markers = [...context.markers, ...monaco.editor.getModelMarkers({ resource: model.uri, owner: OWNER }).filter((m: any) => m.startLineNumber <= range.startLineNumber && m.endLineNumber >= range.startLineNumber)];
   const fixes = quickFixes(model.getValue(), model.getOffsetAt(range.getStartPosition()), markers.map(code), insights);
   return { actions: fixes.map(f => ({ title: f.title, kind: f.kind, isPreferred: !!f.preferred, diagnostics: markers.filter((m: any) => f.codes?.some(c => code(m) === c || code(m).endsWith('/' + c))), command: { id: 'phpforge.composer.run', title: f.title, arguments: [f.request] } })), dispose() {} };
  },
 }, { providedCodeActionKinds: ['quickfix', 'refactor'] }));
 // ⌥Enter vem do host (contexto `plugin-document`, IDE ≥ 0.2.19); repetir o atalho aqui abria o seletor de conflito.
 o.keymap.defineContext('composer-json', (el: Element | null) => !!el && editor.getContainerDomNode().contains(el) && isComposerJson(editor.getModel()));
 o.keymap.registerAction({ id: 'composer.showIntentions', label: 'Composer: mostrar correções e ações', category: 'Composer', aliases: 'composer quick fix intention alt enter', context: 'composer-json', defaults: {}, run: () => editor.trigger('keyboard', 'editor.action.quickFix', {}) });

 const changed = (event: Event) => { const path = String((event as CustomEvent).detail?.path ?? ''); if (/(^|\/)composer\.lock$/.test(path)) void readLock(); if (/(^|\/)composer\.(json|lock)$/.test(path)) schedule(); };
 window.addEventListener('ide-workspace-file-changed', changed); o.own(() => window.removeEventListener('ide-workspace-file-changed', changed));
 o.own(() => { clearTimeout(timer); epoch++; for (const m of monaco.editor.getModels()) monaco.editor.setModelMarkers(m, OWNER, []); for (const c of decorations.values()) c.clear(); });
 return {
  insights, check,
  /** Depois de uma execução do Composer: o lock mudou, refaz as consultas automáticas. */
  afterRun(request: ComposerRequest) { void readLock(); if (pending || ['install', 'update', 'require', 'remove'].includes(request.action)) { pending = false; schedule(200); } },
  reset() { epoch++; clearTimeout(timer); running.clear(); for (const k of Object.keys(insights)) delete (insights as any)[k]; for (const k of Object.keys(errors)) delete (errors as any)[k]; render(); notify(); },
 };
}
