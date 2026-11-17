import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {buildPlan, checkedResult, parseDiskFree, parseTestResult, runCommand, runGate, sceneFingerprintSource} from '../scripts/qa-assist-scene-mac.mjs';

test('semantic reference collector includes all M3M artifacts without promotion',async()=>{
  const source=await readFile(new URL('../scripts/qa-assist-scene-mac.mjs',import.meta.url),'utf8');
  for(const name of ['m3m-development-score.json','m3m-boreas-score.json','m3m-controls-score.json'])assert.ok(source.includes(`'${name}'`));
  assert.match(source,/status:'NOT_READY',basis:'Recorded .*M3L\/M3M\/M3N\/M3O\/M3P\/M3Q\/M3R trials are references, not product acceptance/);
});

test('semantic reference collector includes all M3N artifacts without promotion',async()=>{
  const source=await readFile(new URL('../scripts/qa-assist-scene-mac.mjs',import.meta.url),'utf8');
  for(const name of ['m3n-development-score.json','m3n-boreas-score.json','m3n-controls-score.json'])assert.ok(source.includes(`'${name}'`));
  assert.match(source,/M3M\/M3N\/M3O\/M3P\/M3Q\/M3R trials are references, not product acceptance/);
});

test('semantic reference collector keeps M3O diagnosis and fresh scores non-accepting',async()=>{
  const source=await readFile(new URL('../scripts/qa-assist-scene-mac.mjs',import.meta.url),'utf8');
  for(const name of ['m3o-m3n-diagnosis.json','m3o-boreas-score.json','m3o-controls-score.json'])assert.ok(source.includes(`'${name}'`));
  assert.match(source,/status:'NOT_READY',basis:'Recorded .*M3N\/M3O\/M3P\/M3Q\/M3R trials are references, not product acceptance/);
});

test('semantic reference collector keeps M3P component and incomplete Spring evidence non-accepting',async()=>{
  const source=await readFile(new URL('../scripts/qa-assist-scene-mac.mjs',import.meta.url),'utf8');
  for(const name of ['m3p-identity-reviewed.json','m3p-real-pair-score.json','m3p-spring-fetch-incomplete.json'])assert.ok(source.includes(`'${name}'`));
  assert.match(source,/status:'NOT_READY',basis:'Recorded .*M3O\/M3P\/M3Q\/M3R trials are references, not product acceptance/);
  assert.ok(source.includes('M3P selected-pair identity/component results are not warning recall'));
  assert.ok(source.includes('incomplete Spring retrieval is not completed ground-truth evaluation'));
  assert.equal(sceneFingerprintSource('scripts','fetch_assist_scene_flow_reference.py'),true);
  assert.equal(sceneFingerprintSource('scripts','fetch_unrelated_data.py'),false);
});

test('M3Q collector retains non-accepting evidence and all scoped fetcher bindings',async()=>{
  const source=await readFile(new URL('../scripts/qa-assist-scene-mac.mjs',import.meta.url),'utf8');
  for(const name of ['m3q-boreas-score.json','m3q-verification.json'])assert.ok(source.includes(`'${name}'`));
  assert.ok(source.includes('M3Q point-transfer component results are not warning recall'));
  assert.ok(source.includes('Disputed M3Q reference geometry is not trusted optical-flow ground truth'));
  for(const name of ['fetch_assist_scene_m3q_reference.py','fetch_assist_scene_m3q_boreas.py','fetch_assist_scene_m3q_low_speed.py'])
    assert.equal(sceneFingerprintSource('scripts',name),true,name);
  assert.equal(sceneFingerprintSource('scripts','fetch_unrelated_data.py'),false);
  assert.equal(sceneFingerprintSource('scripts','fetch_assist_scene_m3q_reference.json'),false);
  assert.equal(buildPlan('/checkout').find(s=>s.name==='python-scene').timeoutMs,180_000);
});

test('M3R collector binds current code and requires its TIP without promoting identity certificates',async()=>{
  const source=await readFile(new URL('../scripts/qa-assist-scene-mac.mjs',import.meta.url),'utf8');
  for(const name of ['m3r-development-association.json','m3r-boreas-score.json','m3r-verification.json'])
    assert.ok(source.includes(`'${name}'`));
  for(const name of ['assist_scene_m3r_association.py','assist_scene_m3r_study.py','fetch_assist_scene_m3r_boreas.py']) {
    assert.equal(sceneFingerprintSource('scripts',name),true,name);
    assert.ok(source.includes(`'scripts/${name}'`),name);
  }
  for(const name of ['test_assist_scene_m3r_association.py','test_assist_scene_m3r_study.py','test_assist_scene_m3r_data.py']) {
    assert.equal(sceneFingerprintSource('tests',name),true,name);
    assert.ok(source.includes(`'tests/${name}'`),name);
  }
  assert.ok(source.includes("'docs/TIP-65-M3R-MAC.md'"));
  assert.ok(source.includes('for(const file of M3R_REQUIRED_FILES)await access(join(root,file),constants.R_OK)'));
  assert.ok(source.includes('M3R numeric identity-chain certificates are not independently established physical identity or phone acceptance'));
  assert.equal(buildPlan('/checkout').find(s=>s.name==='python-scene').timeoutMs,180_000);
});

test('source binding includes hyphenated review/import/scoring tools exercised by tests',()=>{
  for(const name of ['assist_scene_m3f_study.py','assist_scene_window_loom.py','diagnose_assist_scene_approach.py','audit_assist_scene_m3k.py','reconstruct_assist_scene_m3k_growth.py','serve-assist-scene-review.py','fetch-assist-scene-boreas-slice.py',
    'fetch-assist-scene-pandaset-slice.py','convert-assist-scene-pandaset-labels.py',
    'score-assist-scene-motion-m3c.py','prepare-assist-scene-motion.py','assist-scene-mac.py','fetch_assist_scene_flow_reference.py'])
    assert.equal(sceneFingerprintSource('scripts',name),true,name);
  for(const name of ['test_assist_scene_review.py','test_assist_scene_m3f_study.py','test-qa-assist-scene-mac.mjs'])
    assert.equal(sceneFingerprintSource('tests',name),true,name);
  assert.equal(sceneFingerprintSource('scripts','unrelated-model.bin'),false);
  assert.equal(sceneFingerprintSource('tests','unrelated.test.ts'),false);
});

test('requires actual nonzero clean Python/XCTest completion, not generic success text',()=>{
  assert.deepEqual(parseTestResult('python','...\nRan 124 tests in 6.892s\n\nOK\n'),{total:124,failed:0,skipped:0});
  assert.deepEqual(parseTestResult('swift',"Test Suite 'All tests' passed.\nExecuted 117 tests, with 0 failures (0 unexpected) in 0.030 seconds\n"),{total:117,failed:0});
  for(const [kind,log] of [
    ['python','Ran 0 tests in 0.0s\n\nOK\n'],['python','Ran 1 test in 0.1s\n\nOK (skipped=1)\n'],
    ['python','Ran 1 test in 0.1s\nFAILED\n'],['python','OK\n'],
    ['swift','Executed 0 tests, with 0 failures'],['swift','Executed 1 test, with 1 failure'],
    ['swift','error: compile failed\nExecuted 1 test, with 0 failures'],['ios-build','** BUILD FAILED **'],
  ])assert.throws(()=>parseTestResult(kind,log));
  assert.equal(parseTestResult('ios-build','** BUILD SUCCEEDED **').signed,false);
  assert.deepEqual(parseTestResult('node-test','# tests 7\n# pass 7\n# fail 0\n# cancelled 0\n# skipped 0\n'),{total:7,failed:0,cancelled:0,skipped:0});
  assert.throws(()=>parseTestResult('node-test','# tests 7\n# pass 0\n# fail 7\n# cancelled 0\n# skipped 0\n'));
});

test('disk floor parsing fails closed on missing or malformed data',()=>{
  assert.equal(parseDiskFree('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 999 10 12000000 1% /\n'),12000000);
  for(const invalid of ['', 'Filesystem only', '/dev/test 999 10 NaN 1% /', '/dev/test 999 10 -1 1% /'])
    assert.throws(()=>parseDiskFree(invalid));
});

test('plan never installs packages, signs, creates per-task build directory or touches devices',()=>{
  const plan=buildPlan('/checkout',{nativeBuild:true,typecheck:true});
  assert.equal(plan.length,5);
  const native=plan.find(p=>p.parser==='ios-build');
  assert.ok(native.args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert.equal(native.args[native.args.indexOf('-derivedDataPath')+1],'native/ios/.build-xcode');
  const all=plan.map(s=>[s.command,...s.args].join(' ')).join('\n');
  assert.doesNotMatch(all,/\b(?:install|simctl|devicectl|curl|pip|git|fetch)\b/);
  assert.ok(plan.find(s=>s.parser==='swift').args.includes('--disable-automatic-resolution'));
});

test('actual missing child executable cannot produce pass',async()=>{
  const result=await runCommand('/definitely-missing-codex-readiness-binary',[],{timeoutMs:1000});
  assert.equal(result.error,'ENOENT');
  assert.throws(()=>checkedResult({name:'missing',parser:'python'},result));
});

test('actual failed child and empty test discovery cannot produce pass',async()=>{
  const result=await runCommand(process.execPath,['-e',"console.log('Ran 3 tests in 0.2s\\n\\nOK'); process.exit(7)"],{timeoutMs:1000});
  assert.equal(result.code,7);
  assert.throws(()=>checkedResult({name:'bad',parser:'python'},result));
  const empty=await runCommand(process.execPath,['-e',"console.log('Ran 0 tests in 0.2s\\n\\nOK')"],{timeoutMs:1000});
  assert.equal(empty.code,0);
  assert.throws(()=>checkedResult({name:'empty',parser:'python'},empty));
});

test('time budget and cancellation terminate actual children and fail closed',async()=>{
  const stalled=await runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:50});
  assert.equal(stalled.timedOut,true);
  assert.throws(()=>checkedResult({name:'timeout',parser:'python'},stalled));
  const signal=new AbortController();
  const pending=runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:3000,signal:signal.signal});
  setTimeout(()=>signal.abort(),30);
  const cancelled=await pending;
  assert.equal(cancelled.cancelled,true);
  assert.throws(()=>checkedResult({name:'cancelled',parser:'python'},cancelled));
});

test('missing local Python produces a failed receipt with no physical acceptance or installs',async()=>{
  const date=new Date().toISOString().slice(0,10).replaceAll('-','');
  const scratch=await mkdtemp(join(tmpdir(),'codex-tmp-scene-readiness-test-'+date+'-'));
  try {
    const out=join(scratch,'receipts','missing');
    const result=await runGate({root:scratch,out});
    assert.equal(result.technicalPass,false);
    assert.match(result.failure,/venv missing|less than 10 GiB|macOS/);
    assert.equal(result.physicalDeviceAcceptance,'NOT_TESTED');
    assert.equal(result.releaseApproved,false);
    assert.deepEqual(result.dependencyInstalls,[]);
    assert.deepEqual(result.deviceMutations,[]);
    assert.equal(JSON.parse(await readFile(join(out,'summary.json'),'utf8')).technicalPass,false);
  } finally {await rm(scratch,{recursive:true,force:true});}
});
