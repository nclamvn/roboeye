import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionJournal,retainedRecords,validateJournalRecord,type JournalBackend,type JournalRecord,type DiagnosticPayload} from '../../src/drive/session-journal';
import {DiagnosticLedger} from '../../src/drive/diagnostic-ledger';
class MemoryBackend implements JournalBackend{
  rows:JournalRecord[]=[];fail=false;
  async list(){return structuredClone(this.rows);}
  async put(record:JournalRecord){if(this.fail)throw Error('QuotaExceededError');const old=this.rows.find(r=>r.sessionId===record.sessionId);if(old&&old.sequence>=record.sequence)return;
    this.rows=retainedRecords(this.rows.filter(r=>r.sessionId!==record.sessionId).concat(record),record.sessionId,record.updatedUtc);}
}
function payload(id='test-1'):DiagnosticPayload{
  return {manifest:{sessionId:id,source:'fixture-live-replay',execution:'mock-workers',startedUtc:new Date().toISOString(),timeOrigin:100,
    build:{version:'1.5.0',commit:'8219b578',sourceFingerprint:'abc123'},userAgent:'test browser',
    capabilities:{webgpuPresent:false,crossOriginIsolated:false,videoFrameCallback:true},
    models:{detectorGpuSha256:'a',detectorWasmSha256:'b',metricSha256:'c'},metricMaxAgeMs:1200,wasmThreads:1},
    status:'active',epoch:1,elapsedMs:100,ledger:new DiagnosticLedger().report(),mobileSoak:{schema:'test'},backends:{detector:'wasm',metric:'wasm'}};
}
test('reopen reads original session/checksum and later checkpoints increase sequence',async()=>{
  const backend=new MemoryBackend(),a=new SessionJournal(backend);await a.checkpoint(payload());
  const b=new SessionJournal(backend),saved=await b.load('test-1');assert.equal(saved.sequence,1);
  assert.equal(saved.payload.manifest.source,'fixture-live-replay');assert.match(saved.sha256,/^[a-f0-9]{64}$/);
  await b.checkpoint({...payload(),elapsedMs:3000});assert.equal((await b.load('test-1')).sequence,2);
});
test('quota failure is observable, does not throw to inference caller, and can recover',async()=>{
  const backend=new MemoryBackend(),journal=new SessionJournal(backend);backend.fail=true;
  await journal.checkpoint(payload());assert.equal(journal.health.state,'error');assert.match(journal.health.error!,/Quota/);
  backend.fail=false;await journal.checkpoint(payload());assert.equal(journal.health.state,'saved');
});
test('tampered/unsupported/private payload is rejected; stored original survives',async()=>{
  const backend=new MemoryBackend(),journal=new SessionJournal(backend);await journal.checkpoint(payload());
  const record=await journal.load('test-1');record.payload.elapsedMs++;
  await assert.rejects(validateJournalRecord(record),/Checksum/);
  await assert.rejects(validateJournalRecord({...record,schema:'v0'}),/Schema/);
  await journal.checkpoint({...payload('private'),mobileSoak:{deviceId:'never store'}});
  assert.equal(journal.health.state,'error');assert.equal(backend.rows.length,1);
});
test('retention protects active summary and never keeps more than ten sessions',async()=>{
  const backend=new MemoryBackend(),journal=new SessionJournal(backend);
  for(let i=0;i<14;i++)await journal.checkpoint(payload(`test-${i}`));
  assert.equal(backend.rows.length,10);assert.ok(backend.rows.some(r=>r.sessionId==='test-13'));
  const old=backend.rows.map(r=>({...r,updatedUtc:'2000-01-01T00:00:00.000Z'}));
  assert.equal(retainedRecords(old,'test-13',new Date().toISOString()).length,1);
});
test('integrity export/import round trip, duplicate old checkpoints never regress counts',async()=>{
  const source=new SessionJournal(new MemoryBackend());await source.checkpoint(payload());const record=await source.load('test-1');
  const dest=new SessionJournal(new MemoryBackend());await dest.import(JSON.parse(JSON.stringify(record)));
  await dest.checkpoint({...payload(),elapsedMs:5000});await dest.import(record);
  assert.equal((await dest.load('test-1')).payload.elapsedMs,5000);
});
test('busy storage keeps latest checkpoint rather than growing an unbounded queue',async()=>{
  const backend=new MemoryBackend();let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
  const put=backend.put.bind(backend);let calls=0;backend.put=async(record)=>{if(++calls===1)await wait;await put(record);};
  const journal=new SessionJournal(backend),first=journal.checkpoint(payload());
  for(let i=1;i<=200;i++)void journal.checkpoint({...payload(),elapsedMs:i});release();await first;
  assert.equal((await journal.load('test-1')).payload.elapsedMs,200);assert.equal(calls,2);
});
test('additive source lifecycle round trips while old checkpoints remain valid',async()=>{
  const journal=new SessionJournal(new MemoryBackend());
  await journal.checkpoint({...payload(),sourceLifecycle:{state:'running',events:[],screenAwake:{state:'unsupported'}}});
  const record=await journal.load('test-1');await validateJournalRecord(record);assert.ok(record.payload.sourceLifecycle);
  await journal.checkpoint(payload('old-record'));await validateJournalRecord(await journal.load('old-record'));
});
