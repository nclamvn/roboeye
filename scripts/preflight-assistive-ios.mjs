// Non-mutating Xcode/device discovery; writes only its local QA receipt.
// No login, provisioning change, app installation/launch or identifier retention.
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const evidence=join(root,'docs/evidence/tip64b4'),runId=new Date().toISOString().replace(/[:.]/g,'-');
let scratch,report;
try {
  scratch=await mkdtemp(join(tmpdir(),'codex-tmp-tip64b4-preflight-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'));
  const xcode=spawnSync('xcodebuild',['-version'],{encoding:'utf8',timeout:30_000}),path=join(scratch,'devices.json');
  const scan=spawnSync('xcrun',['devicectl','list','devices','--json-output',path],{encoding:'utf8',timeout:30_000});
  const discovery=scan.status===0?JSON.parse(await readFile(path,'utf8')).result?.devices:null;
  const physical=(discovery??[]).filter(d=>d.hardwareProperties?.reality==='physical');
  const project=spawnSync('plutil',['-convert','json','-o','-',join(root,'native/ios/AssistiveDepthProbe.xcodeproj/project.pbxproj')],{encoding:'utf8',timeout:30_000});
  let signingConfigurations=null;
  if(project.status===0) {
    const objects=JSON.parse(project.stdout).objects,target=Object.values(objects).find(o=>o.isa==='PBXNativeTarget'&&o.name==='AssistiveDepthProbe');
    const configurations=target?objects[target.buildConfigurationList]?.buildConfigurations:null;
    if(configurations)signingConfigurations=configurations.map(id=>({name:objects[id]?.name??'unknown',teamConfigured:/^[A-Z0-9]{10}$/.test(String(objects[id]?.buildSettings?.DEVELOPMENT_TEAM??''))}));
  }
  const teamConfigured=signingConfigurations?['Debug','Release'].every(name=>signingConfigurations.some(c=>c.name===name&&c.teamConfigured)):null;
  report={schemaVersion:3,checkedUtc:new Date().toISOString(),scope:'Xcode/device discovery ONLY; not an installation/readiness acceptance gate',xcode:xcode.status===0?xcode.stdout.trim():null,
    deviceDiscovery:scan.status===0&&Array.isArray(discovery)?'available':'unavailable',
    physicalDevices:physical.map(d=>({model:d.hardwareProperties?.marketingName??d.hardwareProperties?.productType??'unknown',developerMode:d.deviceProperties?.developerModeStatus??'unknown',connection:d.connectionProperties?.transportType??'unknown'})),
    physicalDeviceCount:Array.isArray(discovery)?physical.length:null,appSigningConfigurations:signingConfigurations,signingTeamConfigured:teamConfigured,
    signedBuild:null,signedBuildStatus:'NOT VERIFIED BY DISCOVERY',installed:null,installationStatus:'NOT QUERIED',readyForPhysicalRehearsal:null,
    reason:!Array.isArray(discovery)?'Device discovery unavailable; physical connection state is unknown.':physical.length===0?'Connect, unlock and trust a physical iPhone.':teamConfigured===false?'Select Team for the app Debug and Release configurations; this script changes no signing.':'Discovery alone cannot prove a signed build, installation, accuracy or rehearsal readiness.',
    identifiersRetained:false,credentialsRead:false,scratchRemoved:false};
} finally {
  if(scratch)await rm(scratch,{recursive:true,force:true});
  if(report){report.scratchRemoved=true;const out=join(evidence,'runs','preflight-'+runId);await mkdir(out,{recursive:true});await writeFile(join(out,'install-preflight.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(evidence,'install-preflight.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
}
