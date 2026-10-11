import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../native/ios/Core/ObjectPresentation.swift',import.meta.url),'utf8');
const overlay=await readFile(new URL('../native/ios/App/ObjectOverlay.swift',import.meta.url),'utf8');
const tokens=[...source.matchAll(/public static let (\w+)=ObjectBadgeColor\(name:"([^"]+)",rgb:0x([0-9A-F]{6})\)/g)].map(([,id,name,hex])=>({id,name,hex}));
assert.equal(tokens.length,13,'Palette token changes require deliberate review.');
const evidence=tokens.map(token=>{
  const rgb=[0,2,4].map(offset=>parseInt(token.hex.slice(offset,offset+2),16)/255);
  const linear=rgb.map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  const contrast=1.05/(0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2]+0.05);
  assert.ok(contrast>=4.5,`${token.id} white contrast is ${contrast}`);
  return {...token,whiteContrast:contrast};
});
const common=['person','phone','remote','furniture','book','container','appliance'].map(id=>evidence.find(token=>token.id===id));
assert.equal(new Set(common.map(token=>token.hex)).size,7);
for(const token of common){const c=[0,2,4].map(i=>parseInt(token.hex.slice(i,i+2),16)/255);assert.ok(Math.max(...c)>0.30&&Math.max(...c)-Math.min(...c)>0.15);}
assert.ok(overlay.includes('ObjectClassPalette.colour(for:track.label)'));
assert.ok(overlay.includes('UIColor(red:fill.red,green:fill.green,blue:fill.blue,alpha:1)'));
assert.ok(!overlay.includes('UIAccessibility.isReduceTransparencyEnabled ? .black'));
console.log(JSON.stringify({pass:true,scope:'Portable source-token contrast/integration checks, NOT rendered UI or semantic recognition proof',tokenCount:evidence.length,distinctCommonClasses:7,minimumWhiteContrast:Math.min(...evidence.map(t=>t.whiteContrast)),tokens:evidence},null,2));
