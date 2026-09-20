import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {evaluateLiveEvidence} from '../src/drive/live-evidence';

const args=process.argv.slice(2),fileArg=args.find(arg=>!arg.startsWith('--'));
const level=args.includes('--soak')?'soak':'smoke',requireMetric=args.includes('--require-metric');
if(!fileArg){
  console.error('Usage: npm run verify:drive-live-report -- <drivesense-report.json> [--soak] [--require-metric]');
  process.exit(2);
}

try{
  const input=JSON.parse(await readFile(resolve(fileArg),'utf8'));
  const verdict=evaluateLiveEvidence(input),runtime=level==='soak'?verdict.runtimeSoak:verdict.runtimeSmoke;
  console.log(`DriveSense live ${level}: ${runtime.pass?'PASS':'FAIL'}`);
  console.log(`Report status: ${verdict.status}`);
  console.log(`Metric path: ${verdict.metricPath.status.toUpperCase()}`);
  for(const item of runtime.checks)console.log(`${item.pass?'PASS':'FAIL'} ${item.id}: ${String(item.actual)} (${item.expected})`);
  if(requireMetric)for(const item of verdict.metricPath.checks)console.log(`${item.pass?'PASS':'FAIL'} ${item.id}: ${String(item.actual)} (${item.expected})`);
  console.log(verdict.claimBoundary);
  if(!runtime.pass||(requireMetric&&verdict.metricPath.status!=='pass'))process.exitCode=1;
}catch(error){
  console.error(error instanceof Error?error.message:String(error));process.exitCode=2;
}
