// Current native gate alias. Historical TIP64B1/B2 receipts are immutable.
// Web partner/UI gates remain independent commands, not implied by this alias.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
console.log('qa:assistive-ios delegates to the current TIP64B4 native object gate; historical receipts are preserved.');
const args=process.argv.slice(2).filter(arg=>arg!=='--reuse-web-baseline');
if(process.argv.includes('--reuse-web-baseline'))console.log('Legacy --reuse-web-baseline is obsolete here; this alias makes no web QA claim.');
const child=spawn(process.execPath,[fileURLToPath(new URL('./qa-assistive-objects.mjs',import.meta.url)),...args],{stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.once('error',error=>{console.error(error);process.exitCode=1;});
child.once('close',(code,signal)=>{process.exitCode=signal?1:code??1;});
