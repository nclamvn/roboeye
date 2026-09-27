import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT=resolve(import.meta.dirname,'../..');

test('vendored Wave URDFs resolve every browser visual mesh locally',()=>{
  for(const side of ['left','right']){
    const directory=resolve(ROOT,'public/assets/sharpa-wave',side);
    const urdf=readFileSync(resolve(directory,`${side}_sharpa_wave_with_wrist.urdf`),'utf8');
    const visualBlocks=[...urdf.matchAll(/<visual>[\s\S]*?<\/visual>/g)].map(match=>match[0]);
    const references=visualBlocks.flatMap(block=>
      [...block.matchAll(/filename="package:\/\/[^/]+\/([^"]+)"/g)].map(match=>match[1]));
    assert.equal(new Set(references).size,14,`${side} visual mesh count drifted`);
    for(const reference of new Set(references)){
      const path=resolve(directory,reference);
      assert.ok(existsSync(path),`${side} missing ${reference}`);
      assert.ok(statSync(path).size>1_000,`${side} empty ${reference}`);
    }
  }
});

test('Wave distribution records immutable source and Apache attribution',()=>{
  const directory=resolve(ROOT,'public/assets/sharpa-wave');
  const source=readFileSync(resolve(directory,'SOURCE.md'),'utf8');
  assert.match(source,/0d19cac602f46456b819e4b6a2c09a74982c9a3e/);
  assert.match(readFileSync(resolve(directory,'LICENSE.txt'),'utf8'),/Apache License/);
  assert.ok(statSync(resolve(directory,'NOTICE.txt')).size>0);
});
