import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, rename, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(join(root,'native/ios/Models/assets.json'),'utf8'));
const verifyOnly=process.argv.includes('--verify-only'), fixtures=process.argv.includes('--fixtures');
const assets=[{...manifest.model,directory:'native/ios/Models'}];
if(fixtures)assets.push(...manifest.qaFixtures.map(asset=>({...asset,directory:'native/ios/.build-xcode/model-qa'})));
let active=null,interrupted=false;
function interrupt(){interrupted=true;active?.kill('SIGTERM');}
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);

async function digest(file) {
  const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');
}
async function verified(file,asset) {
  try { return (await stat(file)).size===asset.bytes && await digest(file)===asset.sha256; }
  catch(error) { if(error.code==='ENOENT')return false;throw error; }
}
async function download(asset,file) {
  const check=spawnSync('df',['-k','/'],{encoding:'utf8'});
  const free=Number(check.stdout.trim().split('\n').at(-1)?.trim().split(/\s+/)[3]);
  if(check.status!==0 || !Number.isFinite(free) || free<20*1024*1024)throw Error('Stop: need at least20GiB free disk before asset download.');
  await mkdir(dirname(file),{recursive:true});
  const partial=`${file}.download-partial`;
  try {
    // Direct public files only: no private data, token, account or API required.
    const code=await new Promise((resolve,reject)=>{
      const child=spawn('curl',['--fail','--location','--retry','2','--connect-timeout','20','--max-time','240','--output',partial,asset.url],{stdio:'inherit'});active=child;
      child.once('error',reject);child.once('close',code=>{active=null;resolve(code);});
    });
    if(code!==0 || interrupted)throw Error(`Asset download failed/interrupted: ${asset.file}`);
    if(!await verified(partial,asset))throw Error(`Hash/size mismatch: ${asset.file}; refusing to install unverified asset.`);
    await rename(partial,file);
  } finally { await rm(partial,{force:true}); }
}
try {
  for(const asset of assets) {
    if(interrupted)throw Error('Asset verification interrupted.');
    const file=join(root,asset.directory,asset.file);
    if(!await verified(file,asset)) {
      if(verifyOnly)throw Error(`Missing or unverified ${asset.file}. Run npm run assets:assistive-objects${fixtures?' -- --fixtures':''}.`);
      await download(asset,file);
    }
    console.log(`VERIFIED ${asset.file} ${asset.bytes}bytes sha256=${asset.sha256}`);
  }
} finally { process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt); }
