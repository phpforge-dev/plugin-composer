import {build} from 'esbuild';
await build({entryPoints:['src/index.ts'],outfile:'main.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true});
await build({entryPoints:['src/ui/panel.ts'],outfile:'workbench.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
