#!/usr/bin/env node
// Mac-local structural gate, not physical/semantic acceptance or a release.
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const LOG_LIMIT=2*1024*1024, OUTPUT_LIMIT=16*1024*1024;
export const MIN_FREE_KIB=10*1024*1024;

export function parseDiskFree(text) {
  const row=text.trim().split('\n').at(-1)?.trim().split(/\s+/);
  const free=Number(row?.[3]);
  if(!row || row.length<6 || !Number.isSafeInteger(free) || free<0)throw Error('Cannot verify disk space.');
  return free;
}

export function parseTestResult(kind, text) {
  if(kind==='node-test') {
    const count=key=>Number([...text.matchAll(new RegExp(`(?:#|ℹ) ${key} (\\d+)`, 'g'))].at(-1)?.[1]??NaN);
    const total=count('tests'),passed=count('pass'),failed=count('fail'),cancelled=count('cancelled'),skipped=count('skipped');
    if(!Number.isSafeInteger(total)||total<1||passed!==total||failed!==0||cancelled!==0||skipped!==0)
      throw Error('Readiness policy tests lack clean nonzero complete results.');
    return {total,failed,cancelled,skipped};
  }
  if(kind==='python') {
    const count=[...text.matchAll(/Ran (\d+) tests? in [\d.]+s/g)].at(-1);
    // A zero exit alone or an old/partial success line cannot prove discovery.
    if(!count || Number(count[1])<1 || !/\nOK\s*$/.test(text)
        || /\b(?:FAILED|ERROR:|FAIL:)\b/.test(text))throw Error('Python discovery lacks a clean nonzero final result.');
    return {total:Number(count[1]),failed:0,skipped:0};
  }
  if(kind==='swift') {
    const counts=[...text.matchAll(/Executed (\d+) tests?, with (\d+) failures?(?: \((\d+) unexpected\))?/g)];
    const final=counts.at(-1);
    if(!final || Number(final[1])<1 || Number(final[2])!==0 || Number(final[3]??0)!==0
        || /(?:Test Suite .* failed|error:|Test Case .* failed)/.test(text))throw Error('Swift XCTest lacks a clean nonzero final result.');
    return {total:Number(final[1]),failed:0};
  }
  if(kind==='ios-build') {
    if(!text.includes('** BUILD SUCCEEDED **') || text.includes('** BUILD FAILED **'))throw Error('No successful unsigned iOS build result.');
    return {built:true,signed:false,installed:false};
  }
  if(kind==='typecheck')return {typechecked:true};
  throw Error('Unknown result parser.');
}

export function buildPlan(root, {typecheck=false,nativeBuild=false}={}) {
  const plan=[
    {name:'readiness-policy',parser:'node-test',command:process.execPath,
      args:['--test','tests/test-qa-assist-scene-mac.mjs'],timeoutMs:60_000},
    {name:'python-scene',parser:'python',command:join(root,'native/ios/.build-xcode/scene-qa/venv/bin/python'),
      args:['-m','unittest','discover','-s','tests','-p','test_assist_scene_*.py'],timeoutMs:180_000},
    {name:'swift-core',parser:'swift',command:'swift',
      args:['test','--package-path','native/ios','--scratch-path','native/ios/.build','--disable-automatic-resolution'],timeoutMs:600_000},
  ];
  if(typecheck)plan.push({name:'typescript',parser:'typecheck',command:process.execPath,
    args:['node_modules/typescript/bin/tsc','--noEmit'],timeoutMs:180_000});
  if(nativeBuild)plan.push({name:'unsigned-ios-release',parser:'ios-build',command:'xcodebuild',
    args:['-project','native/ios/AssistiveDepthProbe.xcodeproj','-scheme','AssistiveDepthProbe',
      '-configuration','Release','-destination','generic/platform=iOS','-derivedDataPath','native/ios/.build-xcode',
      '-disableAutomaticPackageResolution','CODE_SIGNING_ALLOWED=NO','build'],timeoutMs:900_000});
  return plan;
}

export function runCommand(command,args,{cwd,timeoutMs,signal,onProgress=()=>{}}={}) {
  return new Promise(resolvePromise=>{
    if(signal?.aborted){resolvePromise({code:null,signal:'aborted',cancelled:true,timedOut:false,outputExceeded:false,output:'',elapsedMs:0});return;}
    const started=performance.now();
    let child,output='',totalBytes=0,timedOut=false,cancelled=false,outputExceeded=false,error=null;
    let forceTimer,timer,progress,lastProgress=Date.now(),done=false;
    const stop=()=>{
      if(child?.pid)try{process.kill(-child.pid,'SIGTERM');}catch{}
      if(!forceTimer)forceTimer=setTimeout(()=>{if(child?.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}},2500);
    };
    const cancel=()=>{cancelled=true;stop();};
    const finish=(code,exitSignal)=>{
      if(done)return;done=true;clearTimeout(timer);clearTimeout(forceTimer);clearInterval(progress);
      signal?.removeEventListener('abort',cancel);
      resolvePromise({code,signal:exitSignal??null,timedOut,cancelled,outputExceeded,error,output,
        outputBytes:totalBytes,retainedBytes:Buffer.byteLength(output),elapsedMs:Math.round(performance.now()-started)});
    };
    try {
      child=spawn(command,args,{cwd,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},detached:true,stdio:['ignore','pipe','pipe']});
      signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted)cancel();
      const capture=chunk=>{
        totalBytes+=chunk.length;
        output=(output+chunk.toString('utf8')).slice(-LOG_LIMIT);
        if(totalBytes>OUTPUT_LIMIT){outputExceeded=true;stop();}
        if(Date.now()-lastProgress>15_000){lastProgress=Date.now();onProgress();}
      };
      child.stdout.on('data',capture);child.stderr.on('data',capture);
      child.once('error',e=>{error=String(e.code??e.message);finish(null,null);});
      child.once('close',finish);
      timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs??60_000);
      progress=setInterval(()=>{if(Date.now()-lastProgress>15_000){lastProgress=Date.now();onProgress();}},15_000);
    } catch(e){error=e.message;finish(null,null);}
  });
}

export function checkedResult(step,result) {
  if(result.code!==0 || result.timedOut || result.cancelled || result.outputExceeded || result.error || result.signal)
    throw Error(`${step.name}: subprocess failed, cancelled, timed out or exceeded output budget.`);
  return parseTestResult(step.parser,result.output);
}

async function walk(root,folder,files) {
  const base=join(root,folder);
  for(const entry of await readdir(base,{withFileTypes:true})) {
    if(entry.name.startsWith('.') || entry.name==='xcuserdata' || entry.name==='Models')continue;
    const rel=join(folder,entry.name);
    if(entry.isDirectory())await walk(root,rel,files);
    else if(entry.isFile() && /\.(swift|plist|mjs|pbxproj|xcscheme)$/.test(entry.name))files.push(rel);
  }
}

export function sceneFingerprintSource(folder,name) {
  if(folder==='scripts')return name.endsWith('.py') && (name.startsWith('assist_scene_') || name.includes('assist-scene-')
    || name.startsWith('diagnose_assist_scene_') || name.startsWith('audit_assist_scene_')
    || name.startsWith('reconstruct_assist_scene_'));
  return folder==='tests' && (/^test_assist_scene_.*\.py$/.test(name) || name==='test-qa-assist-scene-mac.mjs');
}

export async function sourceFingerprint(root) {
  const files=['scripts/qa-assist-scene-mac.mjs','package.json','package-lock.json','native/ios/Models/assets.json'];
  await walk(root,'native/ios',files);
  for(const folder of ['scripts','tests'])for(const name of await readdir(join(root,folder)))
    if(sceneFingerprintSource(folder,name))files.push(join(folder,name));
  const hash=createHash('sha256');
  for(const file of [...new Set(files)].sort()){hash.update(file);hash.update(await readFile(join(root,file)));}
  return {sha256:hash.digest('hex'),fileCount:new Set(files).size};
}

async function semantics(root) {
  const entries=[];
  for(const name of ['m3d-boreas-2d-score.json','m3e-boreas-score.json','m3e-controls-score.json',
    'm3f-boreas-score.json','m3f-controls-score.json','m3g-boreas-score.json','m3g-controls-score.json',
    'm3h-boreas-score.json','m3h-controls-score.json',
    'm3i-development-score.json','m3i-boreas-score.json','m3i-controls-score.json',
    'm3j-development-score.json','m3j-boreas-score.json','m3j-controls-score.json',
    'm3k-development-score.json','m3k-boreas-score.json','m3k-controls-score.json',
    'm3l-development-score.json','m3l-boreas-score.json','m3l-controls-score.json',
    'm3m-development-score.json','m3m-boreas-score.json','m3m-controls-score.json',
    'm3n-development-score.json','m3n-boreas-score.json','m3n-controls-score.json',
    'm3o-m3n-diagnosis.json','m3o-boreas-score.json','m3o-controls-score.json']) {
    const rel='docs/evidence/tip65/'+name;
    try {
      const raw=await readFile(join(root,rel));const data=JSON.parse(raw);
      entries.push({path:rel,sha256:createHash('sha256').update(raw).digest('hex'),inputSha256:data.inputSha256,
        unit:data.unit??null,totals:data.totals??null,review:data.review??null});
    } catch(error){entries.push({path:rel,status:'UNAVAILABLE',reason:error.code??error.message});}
  }
  return {status:'NOT_READY',basis:'Recorded M3D/M3E/M3F/M3G/M3H/M3I/M3J/M3K/M3L/M3M/M3N/M3O trials are references, not product acceptance or evidence of universal approach recall. No semantic trial is rerun or recertified by this structural gate; recorded evidence is not current inference.',
    evidence:entries};
}

export async function runGate({root=ROOT,typecheck=false,nativeBuild=false,out,signal}={}) {
  const runId=new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
  const destination=out??join(root,'docs/evidence/tip65/mac-readiness/runs',runId);
  if(relative(root,destination).startsWith('..')||!isAbsolute(destination))throw Error('Receipt output must be inside the checkout.');
  await mkdir(destination,{recursive:false}).catch(async e=>{
    if(e.code==='ENOENT'){await mkdir(dirname(destination),{recursive:true});await mkdir(destination);}
    else throw e;
  });
  const receipt={schemaVersion:1,checkedUtc:new Date().toISOString(),scope:'Mac-local structural regression; not model/phone/user acceptance',
    technicalPass:false,physicalDeviceAcceptance:'NOT_TESTED',phoneDetectionRecall:'NOT_TESTED',phoneLatency:'NOT_TESTED',
    physicalRangeAccuracy:'NOT_TESTED',thermal30Minutes:'NOT_TESTED',voiceOverPhysicalAcceptance:'NOT_TESTED',
    releaseApproved:false,requested:{typecheck,nativeBuild},platform:process.platform,architecture:process.arch,node:process.version,
    networkActions:[],dependencyInstalls:[],deviceMutations:[],extraBuildDirectories:[],stages:[]};
  let before=null;
  try {
    if(process.platform!=='darwin')throw Error('This gate requires an existing macOS/Xcode installation.');
    const disk=spawnSync('df',['-k','/'],{encoding:'utf8',timeout:10_000});
    if(disk.status!==0)throw Error('Disk preflight failed.');
    receipt.diskFreeKiB=parseDiskFree(disk.stdout);
    if(receipt.diskFreeKiB<MIN_FREE_KIB)throw Error('Stop: less than 10 GiB free.');
    const python=join(root,'native/ios/.build-xcode/scene-qa/venv/bin/python');
    await access(python,constants.X_OK).catch(()=>{throw Error('Existing SceneQA Python venv missing; no dependencies were installed.');});
    for(const command of ['swift',...(nativeBuild?['xcodebuild']:[])]) {
      const version=spawnSync(command,['-version'],{encoding:'utf8',timeout:30_000});
      if(version.status!==0)throw Error(`Missing/unavailable ${command}; this gate installs nothing.`);
      receipt[command+'Version']=(version.stdout+'\n'+version.stderr).trim().slice(0,2048);
    }
    const probe=spawnSync(python,['-c','import cv2,numpy,PIL; print(cv2.__version__)'],{encoding:'utf8',timeout:30_000});
    if(probe.status!==0)throw Error('Existing Python runtime lacks OpenCV, NumPy or Pillow; this gate installs nothing.');
    receipt.opencvVersion=probe.stdout.trim();
    if(typecheck)await access(join(root,'node_modules/typescript/bin/tsc')).catch(()=>{throw Error('Existing TypeScript install missing; no npm install performed.');});
    receipt.semantics=await semantics(root);
    before=await sourceFingerprint(root);receipt.sourceBefore=before;
    for(const step of buildPlan(root,{typecheck,nativeBuild})) {
      if(signal?.aborted)throw Error('Gate cancelled.');
      console.log('Mac QA: '+step.name);
      const result=await runCommand(step.command,step.args,{cwd:root,signal,timeoutMs:step.timeoutMs,
        onProgress:()=>console.log('Mac QA: '+step.name+' remains running within its timeout.')});
      await writeFile(join(destination,step.name+'.log'),result.output);
      const record={name:step.name,command:relative(root,step.command).startsWith('..')?step.command:relative(root,step.command),
        args:step.args,exitCode:result.code,signal:result.signal,timedOut:result.timedOut,cancelled:result.cancelled,
        outputExceeded:result.outputExceeded,elapsedMs:result.elapsedMs,outputBytes:result.outputBytes??0,status:'FAIL'};
      receipt.stages.push(record);
      record.summary=checkedResult(step,result);record.status='PASS';
      console.log('Mac QA: '+step.name+' PASS '+JSON.stringify(record.summary));
    }
    receipt.sourceAfter=await sourceFingerprint(root);
    receipt.sourceUnchanged=before.sha256===receipt.sourceAfter.sha256;
    if(!receipt.sourceUnchanged)throw Error('Source changed during the gate; rerun after edits are complete.');
    receipt.technicalPass=true;
  } catch(error){receipt.failure=error.message;}
  finally {
    receipt.finishedUtc=new Date().toISOString();
    await writeFile(join(destination,'summary.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log('Mac QA receipt: '+join(destination,'summary.json'));
  }
  return receipt;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const allowed=new Set(['--typecheck','--native-build','--help']);
  if(args.some(a=>!allowed.has(a))){console.error('Unknown option. Use --help.');process.exitCode=2;}
  else if(args.includes('--help'))console.log('Usage: node scripts/qa-assist-scene-mac.mjs [--typecheck] [--native-build]\nUses existing local tools only. Never installs, launches simulators/phones, downloads models, or approves a release.');
  else {
    const cancel=new AbortController();
    const handle=()=>cancel.abort();
    process.on('SIGINT',handle);process.on('SIGTERM',handle);
    try {
      const result=await runGate({typecheck:args.includes('--typecheck'),nativeBuild:args.includes('--native-build'),signal:cancel.signal});
      if(!result.technicalPass){console.error('Mac QA FAIL: '+result.failure);process.exitCode=1;}
      else console.log('Mac structural QA PASS. Physical-device and semantic acceptance remain unverified.');
    } catch(error){console.error(error.message);process.exitCode=1;}
    finally{process.off('SIGINT',handle);process.off('SIGTERM',handle);}
  }
}
