import test from 'node:test';
import assert from 'node:assert/strict';
import {trackColour,TRACK_IDENTITY_COLOUR_COUNT} from '../../src/drive/track-identity';

test('consecutive vehicle IDs receive distinct stable colours',()=>{
  const colours=Array.from({length:TRACK_IDENTITY_COLOUR_COUNT},(_,index)=>trackColour(index+1));
  assert.equal(new Set(colours).size,TRACK_IDENTITY_COLOUR_COUNT);
  assert.equal(trackColour(4),trackColour(4));
  assert.notEqual(trackColour(4),trackColour(5));
});

test('track colour mapping stays deterministic for defensive inputs',()=>{
  assert.equal(trackColour(Number.NaN),trackColour(1));
  assert.equal(trackColour(-2),trackColour(2));
  assert.equal(trackColour(TRACK_IDENTITY_COLOUR_COUNT+1),trackColour(1));
});
