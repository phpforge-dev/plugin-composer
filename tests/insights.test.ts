import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditProblems, dependencies, insightSummary, quickFixes, updateHints, type AuditResult } from '../src/shared/composer-insights';

const json = `{
  "name": "fixture/app",
  "require": {
    "php": ">=8.1",
    "guzzlehttp/guzzle": "^7.4",
    "psr/log": "^1.0 || ^2.0 || ^3.0"
  },
  "require-dev": {
    "symfony/var-dumper": "^6.0"
  },
  "scripts": { "lint": "php -l src" }
}`;
const at = (marker: string) => { const i = json.indexOf(marker); assert.ok(i >= 0, marker); return i + 2; };
// Saídas reais do Composer 2.11.1 (native/fixtures) já convertidas pelo serviço Rust.
const raw = JSON.parse(readFileSync(new URL('../native/fixtures/audit.json', import.meta.url), 'utf8'));
const audit: AuditResult = { advisories: raw.advisories['guzzlehttp/guzzle'].map((a: any) => ({ name: a.packageName, id: a.advisoryId, title: a.title, cve: a.cve, link: a.link, affected: a.affectedVersions, severity: a.severity })), abandoned: [{ name: 'psr/log', replacement: null }] };
const updates = [
 { name: 'guzzlehttp/guzzle', from: '7.4.0', to: '7.16.1', downgrade: false },
 { name: 'guzzlehttp/promises', from: '1.5.3', to: '2.6.0', downgrade: false },
 { name: 'Symfony/Var-Dumper', from: 'v6.0.0', to: 'v6.4.49', downgrade: false },
];

test('dependências diretas com a posição da chave', () => {
 assert.deepEqual(dependencies(json).map(d => [d.name, d.section, d.constraint]), [['php', 'require', '>=8.1'], ['guzzlehttp/guzzle', 'require', '^7.4'], ['psr/log', 'require', '^1.0 || ^2.0 || ^3.0'], ['symfony/var-dumper', 'require-dev', '^6.0']]);
 assert.deepEqual(dependencies('{ inválido'), []);
});

test('gutter: só dependências diretas, sem diferenciar maiúsculas', () => {
 assert.deepEqual(updateHints(json, updates).map(h => [h.name, h.to]), [['guzzlehttp/guzzle', '7.16.1'], ['symfony/var-dumper', 'v6.4.49']]);
 assert.deepEqual(updateHints(json, [{ name: 'psr/log', from: '3', to: '2', downgrade: true }]), [], 'downgrade não vira atualização');
});

test('audit: marcador na chave da dependência direta, indiretas agrupadas e abandonados', () => {
 const problems = auditProblems(json, { ...audit, advisories: [...audit.advisories, { name: 'guzzlehttp/psr7', id: 'PKSA-x', title: 't', affected: '<2', severity: 'low' }] });
 const direct = problems.find(p => p.code === 'composer.vulnerable')!;
 assert.equal(json.slice(direct.keyStart, direct.keyEnd), '"guzzlehttp/guzzle"');
 assert.equal(direct.severity, 'error', 'aviso high vira erro');
 assert.match(direct.message, /2 aviso\(s\).*\nCVE-2026-\d+ \[high\]/s);
 assert.ok(direct.link?.startsWith('https://github.com/advisories/'));
 assert.match(problems.find(p => p.code === 'composer.vulnerable-indirect')!.message, /guzzlehttp\/psr7 \(1\)/);
 assert.equal(problems.find(p => p.code === 'composer.abandoned')!.name, 'psr/log');
 assert.deepEqual(auditProblems(json, undefined), []);
});

test('⌥Enter: pacote não instalado, lock desatualizado, atualização, segurança e script', () => {
 const titles = (offset: number, markers: string[] = [], extra = {}) => quickFixes(json, offset, markers, extra).map(f => `${f.preferred ? '*' : ''}${f.title} => ${f.request.action}${f.request.packages ? ' ' + f.request.packages : ''}${f.request.lock ? ' --lock' : ''}`);
 assert.deepEqual(titles(at('"psr/log'), ['phpforge.composer/composer.not-installed']), [
  '*Instalar psr/log => update psr/log', 'Instalar todos os pacotes (composer install) => install', 'Mostrar por que psr/log está instalado (composer why) => why psr/log']);
 assert.deepEqual(titles(at('"psr/log'), ['composer.package-not-locked']).slice(0, 2), ['*Instalar psr/log => update psr/log', 'Instalar todos os pacotes (composer update) => update']);
 assert.deepEqual(titles(at('"guzzlehttp'), ['composer.vulnerable'], { updates }), [
  '*Atualizar guzzlehttp/guzzle para 7.16.1 (corrige avisos de segurança) => update guzzlehttp/guzzle', 'Atualizar todos os pacotes => update', 'Mostrar por que guzzlehttp/guzzle está instalado (composer why) => why guzzlehttp/guzzle']);
 assert.deepEqual(titles(at('"symfony/var'), [], { updates }).slice(0, 1), ['*Atualizar symfony/var-dumper para v6.4.49 => update symfony/var-dumper']);
 assert.deepEqual(titles(at('"php"')), [], 'pacote de plataforma não tem ações');
 assert.deepEqual(titles(at('"require"'), ['composer.lock-outdated']), ['*Atualizar o hash do composer.lock (composer update --lock) => update --lock', 'Atualizar dependências (composer update) => update']);
 assert.deepEqual(titles(at('"lint')), ["Executar 'lint' => run-script"]);
 assert.equal(quickFixes(json, at('"lint'), [])[0].request.script, 'lint');
 const fix = quickFixes(json, at('"psr/log'), ['x/composer.not-installed'])[0];
 assert.deepEqual(fix.codes, ['x/composer.not-installed'], 'a correção aponta o diagnóstico que resolve');
});

test('resumo das consultas', () => {
 assert.equal(insightSummary({ updates, audit, outdated: [] }), '3 atualização(ões) disponível(is) · 2 aviso(s) de segurança em 1 pacote(s) · 1 abandonado(s) · nenhum desatualizado');
 assert.equal(insightSummary({}), '');
});
