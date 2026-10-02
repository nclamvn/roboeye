import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {fetchVerifiedModelArtifact} from '../../src/drive/model-artifact';

Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const payload=new TextEncoder().encode('verified-model').buffer;
const artifact={file:'model.onnx',bytes:payload.byteLength,sha256:createHash('sha256').update(new Uint8Array(payload)).digest('hex'),releaseUrl:'https://github.com/example/project/releases/download/models-v1/model.onnx'};

test('falls back from absent same-origin model to verified immutable release',async()=>{
  const urls:string[]=[];
  const fetcher:typeof fetch=async input=>{
    const url=String(input);urls.push(url);
    return url.startsWith('https://app.example/')?new Response('',{status:404}):new Response(payload.slice(0),{status:200});
  };
  const result=await fetchVerifiedModelArtifact('https://app.example/','drive-metric',artifact,fetcher);
  assert.equal(result.source,'release');
  assert.deepEqual(urls,['https://app.example/models/drive-metric/model.onnx',artifact.releaseUrl]);
});

test('rejects a release asset that does not match the pinned contract',async()=>{
  const fetcher:typeof fetch=async()=>new Response(new TextEncoder().encode('tampered'),{status:200});
  await assert.rejects(fetchVerifiedModelArtifact('https://app.example/','drive-metric',artifact,fetcher),/Không tải được model đã kiểm chứng/);
});
