import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditProblems, dependencies, insightSummary, updateHints, type AuditResult } from '../src/shared/composer-insights';

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

test('resumo das consultas', () => {
 assert.equal(insightSummary({ updates, audit, outdated: [] }), '3 atualização(ões) disponível(is) · 2 aviso(s) de segurança em 1 pacote(s) · 1 abandonado(s) · nenhum desatualizado');
 assert.equal(insightSummary({}), '');
});
