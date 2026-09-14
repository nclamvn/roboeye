import {mkdir,readFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DA2_DRIVE} from '../src/drive/metric-contract';

const source=new URL('../tests/.metric-cache/da2-drive-392x224.onnx',import.meta.url);
const targetDir=new URL('../public/models/drive-metric/',import.meta.url),target=new URL(DA2_DRIVE.file,targetDir);
const bytes=await readFile(source).catch(()=>{throw Error('Thiếu export landscape. Chạy tests/.metric-venv/bin/python tests/export-da2-drive.py trước.');});
const hash=createHash('sha256').update(bytes).digest('hex');
if(bytes.length!==DA2_DRIVE.bytes||hash!==DA2_DRIVE.sha256)throw Error('Export landscape không khớp contract đã khóa.');
await mkdir(targetDir,{recursive:true});await copyFile(source,target);
console.log(`Staged ${DA2_DRIVE.file} (${bytes.length} bytes, SHA-256 ${hash}).`);
