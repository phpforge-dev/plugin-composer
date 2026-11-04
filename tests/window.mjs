// Janela Composer em WebKit (o WebView do Tauri no macOS) com o bundle e o CSS publicados.
// A API nativa é simulada com saídas reais do Composer (native/fixtures); o editor real é
// coberto pelo harness do php-ide (scripts/check-composer-symfony-ui.mjs).
import {webkit} from '@playwright/test';
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const audit=JSON.parse(await readFile('native/fixtures/audit.json','utf8'));
const outdated=JSON.parse(await readFile('native/fixtures/outdated.json','utf8'));
const fixtures={
 updates:[{name:'guzzlehttp/guzzle',from:'7.4.0',to:'7.16.1',downgrade:false},{name:'psr/log',from:'1.1.0',to:'3.0.2',downgrade:false}],
 audit:{advisories:audit.advisories['guzzlehttp/guzzle'].map(a=>({name:a.packageName,id:a.advisoryId,title:a.title,cve:a.cve,link:a.link,affected:a.affectedVersions,severity:a.severity})),abandoned:[]},
 outdated:outdated.locked.map(p=>({name:p.name,version:p.version,latest:p.latest,status:p['latest-status'],description:p.description,abandoned:false})),
};
const server=createServer(async(req,res)=>{
 if(req.url==='/workbench.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile('workbench.js'));}
 else if(req.url==='/workbench.css'){res.setHeader('Content-Type','text/css');res.end(await readFile('workbench.css'));}
 else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/workbench.css"><style>:root{--surface:#1e1f22;--panel:#2b2d30;--border:#393b40;--text:#dfe1e5;--muted:#8c8f94;--accent:#3574f0;--selection:#2e436e;--ij-error:#db5c5c;--ij-success:#5fb865}body{background:#1e1f22;color:#dfe1e5;font:13px system-ui;margin:0}.code{display:flex;flex-direction:column;height:100vh}</style><div class="left-rail"></div><div class="code"></div>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await webkit.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:700}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async fixtures=>{
  window.nativeDialogs=[];for(const name of ['alert','confirm','prompt'])window[name]=()=>{window.nativeDialogs.push(name);return null;};
  const composer={name:'fixture/app',require:{php:'>=8.1','guzzlehttp/guzzle':'^7.4','psr/log':'^1.0'},'require-dev':{'symfony/var-dumper':'^6.0'},scripts:{lint:'php -l src'}};
  const lock={packages:[{name:'guzzlehttp/guzzle',version:'7.4.0'},{name:'psr/log',version:'1.1.0'}],'packages-dev':[{name:'symfony/var-dumper',version:'v6.0.0'}]};
  window.calls=[];window.checkError=null;let progress=()=>{};
  const disposable={dispose(){}};
  const api={
   workspace:async()=>({root:'/fixture'}),
   read:async path=>{if(path==='composer.json')return {text:JSON.stringify(composer,null,2)};if(path==='composer.lock')return {text:JSON.stringify(lock)};throw Error('missing')},
   onComposerProgress:fn=>{progress=fn;return()=>{}},
   composerCheck:async(kind,runner)=>{window.calls.push('check:'+kind+':'+runner.mode);await new Promise(r=>setTimeout(r,30));if(window.checkError)throw window.checkError;return {kind,command:'composer '+kind,exitCode:kind==='audit'?1:0,result:fixtures[kind]};},
   composerRun:async(id,runner,request)=>{window.calls.push('run:'+[request.action,...(request.packages??[])].join(' '));const text=request.action==='why-not'?'There is no installed package depending on "psr/log" in versions not matching 3.0\n':'guzzlehttp/guzzle 7.4.0 requires guzzlehttp/promises (^1.5)\n';progress({id,text});return {command:'composer '+request.action,exitCode:0,cancelled:false,timedOut:false,durationMs:120,output:text};},
   composerCancel:async()=>{},composerProbe:async()=>({version:'Composer version 2.11.1'}),composerSearch:async()=>[],composerVersions:async()=>[],
  };
  const editor={onMouseDown:()=>disposable,onDidChangeModel:()=>disposable,getModel:()=>null,getContainerDomNode:()=>document.body,createDecorationsCollection:()=>({set(){},clear(){}}),trigger(){}};
  const monaco={editor:{getModels:()=>[],getEditors:()=>[editor],onDidCreateModel:()=>disposable,registerCommand:()=>disposable,setModelMarkers(){},getModelMarkers:()=>[],MouseTargetType:{GUTTER_GLYPH_MARGIN:2}},languages:{registerCodeActionProvider:()=>disposable},MarkerSeverity:{Error:8,Warning:4},Range:class{},Uri:{parse:u=>u}};
  window.actions=[];
  const keymap={registerAction:spec=>{window.actions.push(spec.id+(spec.context?'@'+spec.context:'')+':'+(spec.defaults?.mac??''));return()=>{}},defineContext:()=>()=>{}};
  const html=(s,...v)=>typeof s==='string'?s:s.reduce((a,x,i)=>a+x+(v[i]??''),'');
  const toolIcon=(b,path,label)=>{b.title=label;b.innerHTML='<svg viewBox="0 0 24 24">'+path+'</svg>'};
  const dockWindow=(panel,button)=>()=>{panel.hidden=false;button.setAttribute('aria-pressed','true')};
  const {activate}=await import('/workbench.js');
  window.controller=activate({monaco,listen:async()=>()=>{},tr:s=>s,msg:html,html,keymap,dockWindow,resizeToolWindow(){},toolIcon,own:v=>v,api,host:{status(){},open:async()=>{},changed(){},editor}});
 },fixtures);
 const text=selector=>page.locator(selector).textContent();
 assert.ok((await page.evaluate(()=>window.actions)).includes('composer.showIntentions@composer-json:Alt+Enter'),'⌥Enter registered only for composer.json');
 await page.locator('#show-composer').click();
 await page.waitForFunction(()=>document.querySelectorAll('.composer-row').length===4);
 assert.deepEqual(await page.evaluate(()=>window.calls),[],'no automatic check without composer.json open in the editor');

 // Outdated: structured result, readable report and per-row badges (in/out of constraint).
 await page.locator('[data-check="outdated"]').click();
 await page.waitForFunction(()=>document.getElementById('composer-summary').dataset.state==='passed');
 assert.match(await text('#composer-output'),/guzzlehttp\/guzzle\s+7\.4\.0\s+→ 8\.3\.1\s+fora da restrição/);
 assert.match(await text('#composer-insights'),/3 desatualizado/);
 const guzzle=page.locator('.composer-row',{hasText:'guzzlehttp/guzzle'});
 assert.equal(await guzzle.locator('.composer-badge[data-kind=major]').textContent(),'mais recente 8.3.1');

 // Audit: advisories with CVE/link in the log and a red badge on the vulnerable package.
 await page.locator('[data-check="audit"]').click();
 await page.waitForFunction(()=>/aviso\(s\) de segurança/.test(document.getElementById('composer-summary').textContent));
 const log=await text('#composer-output');
 assert.match(log,/guzzlehttp\/guzzle · CVE-2026-\d+ \[high\]/);assert.match(log,/https:\/\/github\.com\/advisories\//);assert.match(log,/versões afetadas: /);
 assert.equal(await guzzle.locator('.composer-badge[data-kind=vulnerable]').textContent(),'⚠ 2');
 assert.equal(await page.locator('.composer-row',{hasText:'psr/log'}).locator('.composer-badge[data-kind=vulnerable]').count(),0);

 // Failure is recoverable: message in the summary, buttons usable again.
 await page.evaluate(()=>{window.checkError='Composer não encontrado no PATH.';});
 await page.locator('[data-check="audit"]').click();
 await page.waitForFunction(()=>document.getElementById('composer-summary').dataset.state==='error');
 assert.match(await text('#composer-summary'),/não encontrado.*tente novamente/);
 assert.equal(await page.locator('[data-check="audit"]').isDisabled(),false);
 await page.evaluate(()=>{window.checkError=null;});

 // Why (row button) and why-not (dialog), streamed into the log like any Composer command.
 await guzzle.locator('button[title^="Por que"]').click();
 await page.waitForFunction(()=>document.getElementById('composer-summary').dataset.state==='passed'&&/why/.test(document.getElementById('composer-summary').textContent));
 assert.match(await text('#composer-output'),/requires guzzlehttp\/promises/);
 await page.locator('#composer-why').click();
 await page.locator('#composer-why-package').fill('Not A Package');await page.locator('#composer-why-run').click();
 assert.match(await text('#composer-why-state'),/nome completo/);assert.equal(await page.locator('#composer-why-dialog').evaluate(d=>d.open),true,'invalid input keeps the dialog');
 await page.locator('#composer-why-package').fill('psr/log');await page.locator('#composer-why-version').fill('3.0');await page.locator('#composer-why-run').click();
 await page.waitForFunction(()=>window.calls.includes('run:why-not psr/log:3.0'));
 await page.waitForFunction(()=>/no installed package depending/.test(document.getElementById('composer-output').textContent));

 // Automatic checks can be turned off (persisted with the runner settings).
 await page.locator('#composer-settings').click();
 assert.equal(await page.locator('#composer-check-updates').isChecked(),true);assert.equal(await page.locator('#composer-check-audit').isChecked(),true);
 await page.locator('#composer-check-audit').uncheck();await page.locator('#composer-probe').click();
 await page.waitForFunction(()=>document.getElementById('composer-probe-result').dataset.state==='passed');
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('php-ide-composer-checks'))),{updates:true,audit:false});
 await page.screenshot({path:'tests/window.png'});
 assert.deepEqual(await page.evaluate(()=>window.nativeDialogs),[]);assert.deepEqual(errors,[]);
 console.log('Composer window (WebKit) passed:',await page.evaluate(()=>window.calls));
}finally{await browser.close();server.close();}
