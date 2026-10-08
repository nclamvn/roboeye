import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=new URL('..',import.meta.url).pathname;
const out=process.env.ROBOEYE_QA_OUTPUT??'/private/tmp/roboeye-tip62-partner-qa';await mkdir(out,{recursive:true});
async function sourceSnapshot(){
 const hash=createHash('sha256'),files=['drive.html','index.html','vite.config.ts','package.json','package-lock.json'];
 async function walk(dir){for(const entry of await readdir(join(root,dir),{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())await walk(path);else files.push(path);}}
 await walk('src');for(const file of files.sort()){hash.update(file);hash.update(await readFile(join(root,file)));}return hash.digest('hex');
}
const sourceBefore=await sourceSnapshot();
const steps=[['typecheck',['npm','run','typecheck']],['unit',['npm','run','test:unit']],['build',['npm','run','build']],
 ['security',['npm','run','security:audit']],['controls',['node','tests/drive-feature-toggle-e2e.mjs']],['video-anchor',['node','tests/drive-road-layout-e2e.mjs']],
 ['model-smoke-real',['node','tests/drive-mobile-runtime-e2e.mjs']],['mobile-live-mock',['node','tests/drive-mobile-live-e2e.mjs']],
 ['portrait-diagnostics-mock',['node','tests/drive-tip61d-e2e.mjs']],['depth-recovery-mock',['node','tests/drive-metric-recovery-e2e.mjs']],
 ['journal',['node','tests/drive-session-journal-e2e.mjs']],['source-lifecycle-mock',['node','tests/drive-source-lifecycle-e2e.mjs']],
 ['release',['node','tests/release-e2e.mjs']],['release-integrity',['node','scripts/verify-release.mjs']]];
const results=[];
for(const [name,[command,...args]] of steps){
 console.log(`\nQA ${name}`);const started=Date.now();
 const code=await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});let log='';
  child.stdout.on('data',data=>{process.stdout.write(data);log+=data;});child.stderr.on('data',data=>{process.stderr.write(data);log+=data;});
  child.once('error',reject);child.once('exit',async code=>{await writeFile(`${out}/${name}.log`,log);resolve(code);});
 });results.push({name,exitCode:code,elapsedMs:Date.now()-started});
 await writeFile(`${out}/summary.json`,JSON.stringify({softwareOnly:true,sourceBefore,lint:'NOT RUN: no configured lint task',physicalCamera:'Separate NOT TESTED unless real hardware evidence exists',results},null,2));
 if(code!==0){process.exitCode=1;break;}
}
const sourceAfter=await sourceSnapshot(),unchanged=sourceBefore===sourceAfter;
if(!unchanged){console.error('FAIL source changed during QA; rerun on frozen code');process.exitCode=1;}
await writeFile(`${out}/summary.json`,JSON.stringify({pass:results.length===steps.length&&results.every(r=>r.exitCode===0)&&unchanged,
 softwareOnly:true,sourceBefore,sourceAfter,unchanged,lint:'NOT RUN: no configured lint task',physicalCamera:'Separate NOT TESTED unless real hardware evidence exists',results},null,2));
