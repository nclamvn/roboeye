import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../..',import.meta.url).pathname,dir=new URL('../../docs/evidence/tip61d/',import.meta.url);
await mkdir(dir,{recursive:true});
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(name,value)=>writeFile(new URL(name,dir),JSON.stringify(value,null,2)+'\n');
const aspect=await json('/private/tmp/roboeye-tip61d-aspect/result.json'),ui=await json('/private/tmp/roboeye-tip61d-ui/result.json');
if(!aspect.pass||!ui.pass||aspect.external.length||aspect.errors.length)throw Error('Aspect/UI evidence failed');
await save('aspect-parity.json',aspect);await save('ui-verification.json',ui);
const portrait=await json('/private/tmp/roboeye-tip61d-ui/portrait.json'),landscape=await json('/private/tmp/roboeye-tip61d-ui/landscape.json');
await save('ui-attempt-summary.json',{execution:'mock-workers',sourceFingerprint:portrait.diagnostics.manifest.build.sourceFingerprint,
  sources:[portrait,landscape].map(r=>({dimensions:r.runtime.sourceDimensions,epoch:r.diagnostics.epoch,metric:r.diagnostics.ledger.metric,
    reasons:r.diagnostics.ledger.objectTerminalReasons,example:r.diagnostics.ledger.details.find(d=>d.kind==='metric'&&d.outcome==='accepted-observed')})),
  scope:'Original canvas stream + mock workers, pixel-free aggregate/examples; not camera perception or physical distance evidence.'});
await save('native-export.json',{portrait:await json(`${root}/tests/.metric-cache/da2-drive-224x392-manifest.json`),landscape:await json(`${root}/tests/.metric-cache/da2-drive-392x224-manifest.json`)});
const text=execFileSync('npm',['run','test:unit'],{cwd:root,encoding:'utf8'}),count=Number(text.match(/tests\s+(\d+)/)?.[1]),passed=Number(text.match(/pass\s+(\d+)/)?.[1]);
if(!count||count!==passed)throw Error('Unit results did not pass');
const release=await json(`${root}/dist/release.json`);
await save('qa.json',{generatedUtc:new Date().toISOString(),unit:{count,passed},release,
  contract:{portraitSha256:aspect.results.find(r=>r.orientation==='portrait').model.sha256,metricMaxCaptureAgeMs:1200},
  fixtureReferenceHashes:aspect.results.map(r=>({orientation:r.orientation,backend:r.backend,maxAbsM:Math.max(...r.samples.map(s=>s.maxAbsM))})),
  recipe:{bytes:(await readFile(`${root}/scripts/da2-portrait.recipe.json`)).length,sha256:createHash('sha256').update(await readFile(`${root}/scripts/da2-portrait.recipe.json`)).digest('hex')},
  actualPhoneAcceptance:'not run; prior owner report remains baseline, not an after result',physicalDistanceAccuracy:null,roadPlaneApplicability:'deferred; current contradiction policy remains conservative'});
console.log(`PASS collected local evidence, ${passed}/${count} unit tests`);
