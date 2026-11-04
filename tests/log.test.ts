import test from 'node:test';
import assert from 'node:assert/strict';
import { ComposerLog, foldPreview, linkify, logCommand } from '../src/shared/composer-log';

test('linha de comando do log sem o executável, como no PhpStorm', () => {
 assert.equal(logCommand('composer update psr/log --no-interaction --no-ansi', { action: 'update', packages: ['psr/log'] }), 'update psr/log --no-interaction --no-ansi');
 assert.equal(logCommand('php /opt/composer.phar install --no-interaction', { action: 'install' }), 'install --no-interaction');
 assert.equal(logCommand('', { action: 'require', packages: ['monolog/monolog:^3'], dev: true }), 'require --dev monolog/monolog:^3', 'sem comando do backend: pelo pedido');
});

test('entradas acumulam; sucesso dobra, falha e interrupção ficam abertas', () => {
 const log = new ComposerLog();
 log.start('a', 'install', { action: 'install' }); log.append('a', 'Installing\n');
 assert.equal(log.get('a')!.state, 'running'); assert.equal(log.get('a')!.output, 'Installing\n');
 log.finish('a', { command: 'composer install --no-interaction', output: 'Installing\nGenerating autoload files\n', exitCode: 0, durationMs: 1200 });
 assert.deepEqual([log.get('a')!.state, log.get('a')!.folded, log.get('a')!.command], ['passed', true, 'install --no-interaction']);
 log.start('b', 'update', { action: 'update' }); log.finish('b', { output: 'Your requirements could not be resolved\n', exitCode: 2 });
 assert.deepEqual([log.get('b')!.state, log.get('b')!.folded], ['failed', false]);
 log.start('c', 'update', { action: 'update' }); log.finish('c', { error: 'Composer não encontrado no PATH.' });
 assert.equal(log.get('c')!.state, 'failed'); assert.match(log.get('c')!.output, /não encontrado/);
 log.start('d', 'update', { action: 'update' }); log.finish('d', { cancelled: true, exitCode: null });
 assert.equal(log.get('d')!.state, 'cancelled');
 log.toggle('a'); assert.equal(log.get('a')!.folded, false);
 log.start('e', 'install', { action: 'install' }); log.clear();
 assert.deepEqual(log.entries.map(e => e.id), ['e'], 'limpar mantém a execução em andamento');
 log.append('e', 'x'); log.finish('e', { exitCode: 0 }); log.append('e', 'depois'); assert.equal(log.get('e')!.output, 'x', 'saída tardia ignorada');
});

test('prévia da entrada dobrada e links para composer.json/lock', () => {
 const log = new ComposerLog(); const e = log.start('a', 'x', { action: 'install' }); e.output = 'a\n\nb\nc\nd\ne\nf\ng\n';
 assert.equal(foldPreview(e), 'a\nb\nc\nd\ne\nf');
 assert.deepEqual(linkify('All packages for ./composer.json have been updated; see composer.lock.'), [{ text: 'All packages for ' }, { text: './composer.json', path: 'composer.json' }, { text: ' have been updated; see ' }, { text: 'composer.lock', path: 'composer.lock' }, { text: '.' }]);
 assert.deepEqual(linkify('vendor/x/composer.json'), [{ text: 'vendor/x/composer.json' }], 'arquivo de dependência não vira link da raiz');
});

test('CodeLens "Mostrar log" ao lado de install/update (o "Show log" do composer.json no PhpStorm)', async () => {
 const { ComposerPlugin } = await import('../src/shared/language/plugins/composer');
 const lenses = await new ComposerPlugin().codeLenses('composer.json', '{\n "require": { "php": ">=8.2" }\n}');
 assert.deepEqual(lenses.map(l => [l.title, l.arguments[0]]), [['▶ composer install', { action: 'install' }], ['↻ composer update', { action: 'update' }], ['Mostrar log', { show: 'log' }]]);
});
