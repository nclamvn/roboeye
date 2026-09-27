import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {evaluateMobileSoakEvidence} from '../src/drive/mobile-soak-evidence';

const fileArg=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
if(!fileArg){console.error('Usage: npm run verify:drive-mobile-soak -- <drivesense-report.json>');process.exit(2);}

try{
  const input=JSON.parse(await readFile(resolve(fileArg),'utf8')),verdict=evaluateMobileSoakEvidence(input);
  console.log(`DriveSense mobile soak: ${verdict.contract.pass?'COMPLETE':'INCOMPLETE'} · ${verdict.status}`);
  for(const item of verdict.contract.checks)console.log(`${item.pass?'PASS':'FAIL'} ${item.id}: ${String(item.actual)} (${item.expected})`);
  console.log(`Dominant observed stage: ${verdict.dominantObservedStage}`);
  console.log(`10–20m / 0–5m frame-to-overlay p95: ${verdict.performanceTrend.ratio===null?'unavailable':verdict.performanceTrend.ratio.toFixed(2)} · ${verdict.performanceTrend.status}`);
  console.log(verdict.claimBoundary);if(!verdict.contract.pass)process.exitCode=1;
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=2;}
