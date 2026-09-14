import {mkdir,readFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DRIVE_GPU_DETECTOR} from '../src/drive/detector-contract';
const source=new URL(`../tests/.drive-cache/${DRIVE_GPU_DETECTOR.file}`,import.meta.url);
const bytes=await readFile(source).catch(()=>{throw Error('Thiếu graph; chạy npm run fixtures:drive-detector:export trước.');});
const hash=createHash('sha256').update(bytes).digest('hex');
if(bytes.length!==DRIVE_GPU_DETECTOR.bytes||hash!==DRIVE_GPU_DETECTOR.sha256)throw Error('Graph GPU lệch contract: không stage.');
const targetDir=new URL('../public/models/drive-detector/',import.meta.url);await mkdir(targetDir,{recursive:true});
await copyFile(source,new URL(DRIVE_GPU_DETECTOR.file,targetDir));console.log(`Verified/staged ${DRIVE_GPU_DETECTOR.file} · ${hash}`);
