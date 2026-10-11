import {spawn,spawnSync} from 'node:child_process';
import {mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {restoreInitialShutdown} from './assistive-qa-policy.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const evidence=join(root,'docs/evidence/tip64b4');
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const out=join(evidence,'runs',runId),cache=join(root,'native/ios/.build-xcode/model-qa');
const modelOnly=process.argv.includes('--model-only');
const photoIndex=process.argv.indexOf('--local-photo'),localPhoto=photoIndex>=0?process.argv[photoIndex+1]:null;
if(photoIndex>=0&&!localPhoto)throw Error('--local-photo requires a local JPEG. Pixels are never copied to evidence.');
await mkdir(out,{recursive:true});
// Diagnostic capture does not build or mutate the result bundle. Historical
// B1/B2 evidence is never an output directory for this current gate.
const captureIndex=process.argv.indexOf('--capture-ui-failure');
if(captureIndex>=0) {
  const bundle=process.argv[captureIndex+1];if(!bundle||!bundle.endsWith('.xcresult'))throw Error('Provide an existing xcresult path.');
  const logs=[];
  async function discover(directory){for(const e of await readdir(directory,{withFileTypes:true})){const p=join(directory,e.name);if(e.isDirectory())await discover(p);else if(e.name==='StandardOutputAndStandardError.txt')logs.push(p);}}
  await discover(join(resolve(root,bundle),'Staging'));
  const candidates=await Promise.all(logs.map(async file=>({file,text:await readFile(file,'utf8')})));
  const found=candidates.find(c=>/Executed \d+ tests, with [1-9]\d* failure/.test(c.text));
  if(!found)throw Error('No completed failing runner log; do not invent results.');
  const counts=found.text.match(/Executed (\d+) tests, with (\d+) failure/),total=Number(counts[1]),failed=Number(counts[2]);
  await writeFile(join(out,'runner.log'),found.text);
  await writeFile(join(out,'captured-ui-failure.json'),JSON.stringify({pass:false,total,failed,passed:total-failed,source:'Actual existing XCTest Staging output',failureLines:found.text.split('\n').filter(l=>l.includes('error:')||/Test Case .*failed/.test(l)),buildStarted:false,privatePixelsCopied:false},null,2)+'\n');
  console.log('Captured actual failing UI runner output in TIP64B4. No build started.');process.exit(0);
}
const disk=spawnSync('df',['-k','/'],{encoding:'utf8'});
const free=Number(disk.stdout.trim().split('\n').at(-1)?.trim().split(/\s+/)[3]);
if(disk.status!==0||!Number.isFinite(free)||free<20*1024*1024)throw Error('Stop: QA needs at least 20 GiB free.');
await mkdir(cache,{recursive:true});
const manifest=JSON.parse(await readFile(join(root,'native/ios/Models/assets.json'),'utf8'));
const toolchain={node:process.version,xcode:spawnSync('xcodebuild',['-version'],{encoding:'utf8',timeout:30_000}).stdout?.trim()??null,swift:spawnSync('swift',['--version'],{encoding:'utf8',timeout:30_000}).stdout?.trim()??null,platform:process.platform,architecture:process.arch};
const results=[];let pass=false,before=null,active=null,interrupted=false,uiSummary=null,swiftSummary=null,simulator=null,simulatorInitiallyBooted=true;
function cancel(){interrupted=true;if(active?.pid)try{process.kill(-active.pid,'SIGTERM');}catch{}}
process.on('SIGTERM',cancel);process.on('SIGINT',cancel);
async function walk(directory,files,{skipModels=false}={}) {
  for(const e of await readdir(join(root,directory),{withFileTypes:true})) {
    if(e.name.startsWith('.')||e.name==='xcuserdata'||skipModels&&e.name.endsWith('.mlmodel'))continue;
    const p=directory+'/'+e.name;if(e.isDirectory())await walk(p,files,{skipModels});else files.push(p);
  }
}
async function hashFiles(files) {const hash=createHash('sha256');for(const file of [...new Set(files)].sort()){hash.update(file);hash.update(await readFile(join(root,file)));}return hash.digest('hex');}
async function fingerprint(){
  const files=['package.json','package-lock.json','scripts/download-assistive-object-model.mjs','scripts/qa-assistive-objects.mjs','scripts/qa-assistive-ios.mjs','scripts/preflight-assistive-ios.mjs','scripts/generate-assistive-ios-project.mjs','scripts/verify-native-assistive.mjs','scripts/assistive-qa-policy.mjs','scripts/test-assistive-qa-policy.mjs','scripts/test-assistive-class-palette.mjs'];
  if(modelOnly)files.push('native/ios/ModelQA/main.swift','native/ios/Models/assets.json','native/ios/Models/LICENSE-NOTICE.txt','native/ios/Core/ObjectRuntimePolicy.swift','native/ios/Core/ObjectPresentation.swift','native/ios/App/ObjectOverlay.swift');
  else {await walk('native/ios',files,{skipModels:true});files.push('src/assistive/contract.ts','src/assistive/range.ts','src/assistive/corpus.ts');}
  const hash=createHash('sha256');hash.update(await hashFiles(files));hash.update(JSON.stringify(toolchain));return hash.digest('hex');
}
async function historicalFingerprint(){const files=[];for(const d of ['docs/evidence/tip64b1','docs/evidence/tip64b2','docs/evidence/tip64b3'])await walk(d,files);return hashFiles(files);}
const historicalBefore=await historicalFingerprint();
async function run(name,command,args,{timeoutMs=600_000,allowFailure=false,env={}}={}) {
  if(interrupted)throw Error('QA interrupted');console.log('QA '+name);const started=Date.now(),logFile=join(out,name+'.log');
  const outcome=await new Promise((resolvePromise,reject)=>{
    const child=spawn(command,args,{cwd:root,env:{...process.env,...env},detached:true,stdio:['ignore','pipe','pipe']});active=child;
    let stdout='',stderr='',timedOut=false,killTimer,lastFlush=0,lastProgress=Date.now(),writes=Promise.resolve();
    const flush=()=>{const snapshot=stdout+'\n'+stderr;writes=writes.then(()=>writeFile(logFile,snapshot));};
    const capture=stream=>bytes=>{
      if(stream==='stdout')stdout=(stdout+bytes).slice(-2*1024*1024);else stderr=(stderr+bytes).slice(-2*1024*1024);
      if(Date.now()-lastFlush>1000){lastFlush=Date.now();flush();}
      if(Date.now()-lastProgress>15_000){lastProgress=Date.now();console.log('QA '+name+' still running; bounded live log available.');}
    };
    const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGTERM');}catch{};killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},5000);},timeoutMs);
    child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));
    child.once('error',error=>{clearTimeout(timer);active=null;reject(error);});
    child.once('close',async code=>{clearTimeout(timer);clearTimeout(killTimer);active=null;try{flush();await writes;resolvePromise({code,stdout,stderr,timedOut});}catch(error){reject(error);}});
  });
  results.push({name,exitCode:outcome.code,timedOut:outcome.timedOut,elapsedMs:Date.now()-started});
  if(!allowFailure&&(outcome.code!==0||outcome.timedOut||interrupted))throw Error(name+' failed; inspect its TIP64B4 run log.');
  console.log(outcome.stdout.split('\n').slice(-4).join('\n'));return outcome;
}
async function testNames(directory){
  const files=[];await walk(directory,files);
  return (await Promise.all(files.filter(f=>f.endsWith('.swift')).map(async f=>(await readFile(join(root,f),'utf8')).match(/func test\w+\(/g)??[]))).flat().map(s=>s.slice(5,-1)).sort();
}
const originalUICases=['testUnsupportedSimulatorDoesNotInventMetresOrEnableRecording','testSelectedSurfaceConfirmationAndStaleReset','testBackgroundClearsAndNeverAutoRestarts','testRetargetAndRotationRequireFreshSurfaceConfirmation','testLandscapeAndLargeTypeControlsReachable','testAutomaticRecognitionShowsTwoVietnameseBoxesWithoutManualSelection','testAutomaticStopRemovesBoxesAndFreshRange','testAutomaticBackgroundClearsWithoutRestart','testAutomaticStaleBoxesCannotKeepOldMetres','testAutomaticAmbiguousDepthNeverInventsMetric','testAutomaticManualModeAndDiagnosticsRemainAvailable','testDenseSceneRetainsTwelveUniqueIdentitiesWithoutBadgeOrHUDCollisions','testJitterAndReducedMotionKeepIdentityAndNeverExtendStaleMetres','testEdgeObjectsCannotPlaceBadgesOverCameraInstrumentsAfterRotation','testScientificPortraitInstrumentIsCompactAndRecordingIsExplicit','testDenseLargeTypePreservesAccessibleObjectsAndReadableInstruments','testSevenClassesHaveActualDistinctChromaticFillsOnBrightCamera','testUnknownMetresAndReduceTransparencyKeepTheSameOpaqueClassFills'];
try {
  before=await fingerprint();
  await run('qa-restoration-policy',process.execPath,['scripts/test-assistive-qa-policy.mjs']);
  const palette=await run('class-palette-portable',process.execPath,['scripts/test-assistive-class-palette.mjs']);
  await writeFile(join(out,'class-palette.json'),JSON.stringify(JSON.parse(palette.stdout),null,2)+'\n');
  await run('asset-integrity',process.execPath,['scripts/download-assistive-object-model.mjs','--verify-only','--fixtures']);
  await run('model-compile','xcrun',['coremlcompiler','compile','native/ios/Models/YOLOv3FP16.mlmodel',cache]);
  await run('model-runner-compile','xcrun',['--sdk','macosx','swiftc','-module-cache-path',join(cache,'ModuleCache'),'-O','-framework','CoreML','-framework','Vision','-framework','ImageIO','native/ios/Core/ObjectRuntimePolicy.swift','native/ios/ModelQA/main.swift','-o',join(cache,'model-qa')]);
  function validateModelReceipt(receipt,expected) {
    if(!receipt.pass||receipt.schemaVersion!==3||receipt.configuration?.confidenceThreshold!==0.38||receipt.configuration?.iouThreshold!==0.45||!receipt.detections.some(d=>d.label===expected&&d.combinedConfidence>=0.38)||!receipt.modelMetadata.MLModelLicenseKey?.includes('pjreddie/darknet'))throw Error('Actual runtime-threshold confidence/configuration/license proof missing.');
  }
  for(const fixture of manifest.qaFixtures) {
    const outcome=await run('real-model-'+fixture.id,join(cache,'model-qa'),[join(cache,'YOLOv3FP16.mlmodelc'),join(cache,fixture.file),fixture.expectedClass],{timeoutMs:120_000});
    const receipt=JSON.parse(outcome.stdout);validateModelReceipt(receipt,fixture.expectedClass);
    await writeFile(join(out,'real-model-'+fixture.id+'.json'),JSON.stringify({...receipt,fixture,sourceModel:manifest.model},null,2)+'\n');
  }
  if(localPhoto) {
    const outcome=await run('real-model-user-photo',join(cache,'model-qa'),[join(cache,'YOLOv3FP16.mlmodelc'),localPhoto,'refrigerator'],{timeoutMs:120_000});
    const receipt=JSON.parse(outcome.stdout);validateModelReceipt(receipt,'refrigerator');
    await writeFile(join(out,'real-model-user-photo.json'),JSON.stringify({...receipt,sourceModel:manifest.model,privateInput:'User local attachment; pixels not copied or uploaded.'},null,2)+'\n');
  }
  const project='native/ios/AssistiveDepthProbe.xcodeproj/project.pbxproj',projectBefore=await hashFiles([project]);
  const refusal=spawnSync(process.execPath,['scripts/generate-assistive-ios-project.mjs'],{cwd:root,encoding:'utf8'}),projectAfter=await hashFiles([project]);
  const protectedSigning=refusal.status!==0&&refusal.stderr.includes('Refusing to regenerate')&&projectBefore===projectAfter;
  results.push({name:'generator-preserves-existing-project',exitCode:protectedSigning?0:1,projectBefore,projectAfter});if(!protectedSigning)throw Error('Generator signing protection failed.');
  if(!modelOnly) {
    const swift=await run('swift-unit','swift',['test','--package-path','native/ios','--scratch-path','native/ios/.build']);
    const expectedSwift=(await testNames('native/ios/Tests')).length;
    const counts=[...(swift.stdout+'\n'+swift.stderr).matchAll(/Executed (\d+) tests?, with (\d+) failures?/g)].at(-1);
    swiftSummary={expected:expectedSwift,total:counts?Number(counts[1]):null,failed:counts?Number(counts[2]):null};
    if(swiftSummary.total!==expectedSwift||swiftSummary.failed!==0)throw Error('Swift gate must report the exact current test count.');
    await run('interop',process.execPath,['--import','tsx','scripts/verify-native-assistive.mjs'],{env:{ROBOEYE_NATIVE_QA_OUTPUT:out}});
    const xcode=['-quiet','-project','native/ios/AssistiveDepthProbe.xcodeproj','-scheme','AssistiveDepthProbe','-derivedDataPath','native/ios/.build-xcode','CODE_SIGNING_ALLOWED=NO'];
    await run('ios-release-unsigned','xcodebuild',[...xcode,'-configuration','Release','-destination','generic/platform=iOS','build']);
    const appBundle=join(root,'native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app'),bundledModel=join(appBundle,'YOLOv3FP16.mlmodelc');
    if(!(await stat(bundledModel)).isDirectory()||(await stat(join(bundledModel,'coremldata.bin'))).size===0)throw Error('Missing compiled offline model.');
    if(!(await readFile(join(root,'native/ios/Models/LICENSE-NOTICE.txt'))).equals(await readFile(join(appBundle,'LICENSE-NOTICE.txt'))))throw Error('Bundled license differs.');
    results.push({name:'release-offline-model-and-license',exitCode:0,compiledModel:'YOLOv3FP16.mlmodelc',licenseIdentical:true});
    await run('ios-static-analysis','xcodebuild',[...xcode,'-configuration','Release','-destination','generic/platform=iOS','analyze']);
    const devices=spawnSync('xcrun',['simctl','list','devices','available','-j'],{encoding:'utf8',timeout:30_000});if(devices.status!==0)throw Error('Existing simulator discovery failed.');
    const available=Object.entries(JSON.parse(devices.stdout).devices).filter(([runtime])=>runtime.includes('iOS')).flatMap(([,list])=>list).filter(d=>d.isAvailable&&d.name.startsWith('iPhone'));
    const preferred=process.env.ROBOEYE_IOS_SIMULATOR,device=preferred?available.find(d=>d.udid===preferred):available.find(d=>d.state==='Booted')??available[0];if(!device)throw Error('Select an existing iPhone simulator; this script installs no runtime.');
    simulator=device.udid;simulatorInitiallyBooted=device.state==='Booted';results.push({name:'simulator-selection',deviceName:device.name,initialState:device.state,created:false});
    const bundle=join(root,'native/ios/.build-xcode/Logs/Test','TIP64B4-'+runId+'.xcresult');
    const ui=await run('simulator-ui','xcodebuild',[...xcode,'-configuration','Debug','-destination','platform=iOS Simulator,id='+simulator,'-resultBundlePath',bundle,'-parallel-testing-enabled','NO','-collect-test-diagnostics','never','-test-timeouts-enabled','YES','-default-test-execution-time-allowance','60','-maximum-test-execution-time-allowance','120','test'],{timeoutMs:1_200_000,allowFailure:true});
    // Parse even failed XCTest runs before rejecting them. This binds the result
    // to our explicit run, never another concurrently-created "latest" bundle.
    const summary=await run('simulator-summary','xcrun',['xcresulttool','get','test-results','summary','--path',bundle],{timeoutMs:60_000});
    uiSummary=JSON.parse(summary.stdout);await writeFile(join(out,'simulator-ui.json'),JSON.stringify(uiSummary,null,2)+'\n');
    const names=await testNames('native/ios/UITests'),missing=originalUICases.filter(name=>!names.includes(name));
    results.push({name:'ui-required-case-contract',exitCode:missing.length?1:0,required:originalUICases,missing,expected:names.length});
    await run('ui-screenshots','xcrun',['xcresulttool','export','attachments','--path',bundle,'--output-path',join(out,'screenshots'),'--filter','*.png'],{timeoutMs:120_000});
    if(ui.code!==0||ui.timedOut||missing.length||uiSummary.failedTests!==0||uiSummary.passedTests!==names.length||names.length<18)throw Error('All retained and class-fill UI cases must pass; no assertion was waived.');
  }
  pass=true;
} catch(error){console.error(error);results.push({name:'exception',message:error.message});}
finally {
  process.off('SIGTERM',cancel);process.off('SIGINT',cancel);if(active?.pid)try{process.kill(-active.pid,'SIGTERM');}catch{}
  if(simulator&&!simulatorInitiallyBooted) {
    const restoration=restoreInitialShutdown({query:()=>{
      const scan=spawnSync('xcrun',['simctl','list','devices','-j'],{encoding:'utf8',timeout:30_000});
      if(scan.status!==0)return {exitCode:scan.status??1,state:null};
      try {const exact=Object.values(JSON.parse(scan.stdout).devices??{}).flat().find(d=>d.udid===simulator);return {exitCode:0,state:exact?.state??null};}
      catch{return {exitCode:1,state:null};}
    },shutdown:()=>spawnSync('xcrun',['simctl','shutdown',simulator],{encoding:'utf8',timeout:30_000})});
    results.push({name:'restore-simulator-initial-shutdown',exitCode:restoration.restored?0:1,...restoration});if(!restoration.restored)pass=false;
  }
  const after=await fingerprint(),historicalAfter=await historicalFingerprint();if(before!==after||historicalBefore!==historicalAfter)pass=false;
  const receipt={schemaVersion:3,pass,confidencePolicy:'classificationConfidence * observationConfidence >=0.38; NMS confidence0.38/IoU0.45',scope:modelOnly?'real-model smoke and provenance ONLY':'native object QA gates; web UI not rerun',sourceBefore:before,sourceAfter:after,unchanged:before===after,toolchain,historicalEvidenceBefore:historicalBefore,historicalEvidenceAfter:historicalAfter,historicalEvidenceUnchanged:historicalBefore===historicalAfter,results,swift:swiftSummary,uiPassed:uiSummary?.passedTests??null,uiFailed:uiSummary?.failedTests??null,modelFingerprint:manifest.model.sha256,evidenceRun:'docs/evidence/tip64b4/runs/'+runId,physicalDeviceInstallation:null,physicalInstallationStatus:'NOT VERIFIED BY THIS SCRIPT',phoneDetectionRecall:'NOT TESTED',phoneLatency:'NOT TESTED',physicalRangeAccuracy:'NOT TESTED',thermal30Minutes:'NOT TESTED',privatePixelsCopied:false,privatePixelsUploaded:false,scratchDirectoriesCreated:[],extraDependenciesInstalled:false,diskBeforeFreeKiB:free};
  const name=modelOnly?'model-summary.json':'summary.json';await writeFile(join(out,name),JSON.stringify(receipt,null,2)+'\n');await writeFile(join(evidence,name),JSON.stringify(receipt,null,2)+'\n');
}
if(!pass)process.exitCode=1;
