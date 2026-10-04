import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rename, rm, stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));
const artifacts=[
  {
    directory:'drive-metric',file:'da2-outdoor-392x224.onnx',bytes:99159817,
    sha256:'dc868d88c5b97570f59863641092f7a517b85ef567de883a988d7df0e8b7250f',
    url:'https://github.com/nclamvn/roboeye/releases/download/drivesense-models-v1/da2-outdoor-392x224.onnx',
  },
  {
    directory:'drive-detector',file:'rtdetr-r18-640-webgpu.onnx',bytes:81033458,
    sha256:'86171edeb435bd3f113e82d1c6720a576932e6deca962426bb1bc794e7000458',
    url:'https://github.com/nclamvn/roboeye/releases/download/drivesense-models-v1/rtdetr-r18-640-webgpu.onnx',
  },
  // Pinned q8 CPU model + processor: no third-party request from a phone.
  ...[
    {file:'config.json',bytes:5731,sha256:'2146837ddc24e4ab5e7c39d96ffe986d1d9048fdd4d02b37a0af5b59b17821c1'},
    {file:'preprocessor_config.json',bytes:444,sha256:'cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1'},
    {file:'onnx/model_quantized.onnx',bytes:20991219,sha256:'4b839c46187b77fc620c770de0be6790637b98afde9b386232b0fcf74382eb3c'},
  ].map(artifact=>({...artifact,directory:'onnx-community/rtdetr_v2_r18vd-ONNX',url:`https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/resolve/936f90b6a476c6da4dfe053fc521af55285976ba/${artifact.file}`})),
];

async function digest(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}

async function valid(path,artifact){
  try{
    const info=await stat(path);
    return info.isFile()&&info.size===artifact.bytes&&(await digest(path))===artifact.sha256;
  }catch{return false;}
}

for(const artifact of artifacts){
  const directory=`${root}public/models/${artifact.directory}`;
  const destination=`${directory}/${artifact.file}`;
  if(await valid(destination,artifact)){
    console.log(`[drive-models] verified ${artifact.file}`);
    continue;
  }
  await mkdir(dirname(destination),{recursive:true});
  const temporary=`${destination}.${process.pid}.part`;
  await rm(temporary,{force:true});
  try{
    const response=await fetch(artifact.url,{redirect:'follow'});
    if(!response.ok||!response.body)throw Error(`HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary,{flags:'wx'}));
    if(!(await valid(temporary,artifact)))throw Error(`artifact không khớp ${artifact.bytes} byte / SHA-256 đã pin`);
    await rename(temporary,destination);
    console.log(`[drive-models] downloaded and verified ${artifact.file}`);
  }catch(error){
    await rm(temporary,{force:true});
    throw new Error(`[drive-models] không thể chuẩn bị ${artifact.file}: ${error instanceof Error?error.message:String(error)}`);
  }
}
