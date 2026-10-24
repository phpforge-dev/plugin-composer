import {readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
for(const platform of await readdir('artifacts')){
 const files=await readdir(join('artifacts',platform));
 if(files.length!==1)throw Error('Unexpected build artifact');
 execFileSync(process.execPath,['scripts/record-binary.mjs',platform,join('artifacts',platform,files[0])],{stdio:'inherit'});
}
