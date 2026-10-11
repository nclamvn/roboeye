import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Deterministic generated project, no XcodeGen/CocoaPods/SDK install.
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), root=path.join(repo,'native/ios');
const project=path.join(root,'AssistiveDepthProbe.xcodeproj');
// Never rewrite an existing user's Team, bundle ID or device scheme. Updating
// this generator does not authorize erasing a signed local project.
if(fs.existsSync(path.join(project,'project.pbxproj')))throw Error('Refusing to regenerate existing Xcode project/signing. Patch the existing project in place; use this generator only for a new checkout without a project.');
if(!fs.existsSync(path.join(root,'Models/YOLOv3FP16.mlmodel')))throw Error('Missing object model: run npm run assets:assistive-objects before creating a new project.');
const id=k=>crypto.createHash('sha256').update(k).digest('hex').slice(0,24).toUpperCase();
const quote=s=>JSON.stringify(s), objects=[];
const add=(key,value)=>{objects.push(`${id(key)} = { ${value} };`);return id(key);};
// Includes B3 runtime policy/presentation sources without a second manual list.
const appFiles=['Core','App'].flatMap(dir=>fs.readdirSync(path.join(root,dir)).filter(f=>f.endsWith('.swift')).sort().map(f=>`${dir}/${f}`));
const testFiles=['UITests/ProbeUITests.swift'];
const resourceFiles=['Models/YOLOv3FP16.mlmodel','Models/LICENSE-NOTICE.txt'];
const refs=new Map();
for(const file of [...appFiles,...testFiles,'App/Info.plist',...resourceFiles]) refs.set(file,add(`ref:${file}`,`isa = PBXFileReference; lastKnownFileType = ${file.endsWith('.swift')?'sourcecode.swift':file.endsWith('.mlmodel')?'file.mlmodel':file.endsWith('.txt')?'text':'text.plist.xml'}; path = ${quote(file)}; sourceTree = "<group>";`));
function sources(files,key){const builds=files.map(file=>add(`build:${file}`,`isa = PBXBuildFile; fileRef = ${refs.get(file)};`));return add(key,`isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (${builds.join(',')}); runOnlyForDeploymentPostprocessing = 0;`);}
const appSources=sources(appFiles,'appSources'),testSources=sources(testFiles,'testSources');
const resources=add('appResources',`isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (${resourceFiles.map(file=>add(`build:${file}`,`isa = PBXBuildFile; fileRef = ${refs.get(file)};`)).join(',')}); runOnlyForDeploymentPostprocessing = 0;`);
const appProduct=add('appProduct','isa = PBXFileReference; explicitFileType = wrapper.application; path = AssistiveDepthProbe.app; sourceTree = BUILT_PRODUCTS_DIR;');
const testProduct=add('testProduct','isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = ProbeUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;');
const products=add('products',`isa = PBXGroup; children = (${appProduct},${testProduct}); name = Products; sourceTree = "<group>";`);
const group=add('group',`isa = PBXGroup; children = (${[...refs.values(),products].join(',')}); sourceTree = "<group>";`);
const common='CLANG_ENABLE_MODULES = YES; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SDKROOT = iphoneos; SWIFT_VERSION = 5.0; SWIFT_STRICT_CONCURRENCY = minimal; TARGETED_DEVICE_FAMILY = 1; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; CODE_SIGN_STYLE = Automatic;';
function configs(key,extra){const configs=['Debug','Release'].map(name=>add(`${key}:${name}`,`isa = XCBuildConfiguration; name = ${name}; buildSettings = { ${common} ${extra} ${name==='Debug'?'SWIFT_OPTIMIZATION_LEVEL = "-Onone"; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; ENABLE_TESTABILITY = YES;':'SWIFT_OPTIMIZATION_LEVEL = "-O";'} };`));return add(`${key}:list`,`isa = XCConfigurationList; buildConfigurations = (${configs.join(',')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`);}
const appConfigs=configs('app','PRODUCT_NAME = "$(TARGET_NAME)"; PRODUCT_BUNDLE_IDENTIFIER = com.roboeye.assistive.depthprobe; CURRENT_PROJECT_VERSION = 5; MARKETING_VERSION = 0.2.2; INFOPLIST_FILE = App/Info.plist; GENERATE_INFOPLIST_FILE = NO; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";');
const testConfigs=configs('test','PRODUCT_NAME = "$(TARGET_NAME)"; PRODUCT_BUNDLE_IDENTIFIER = com.roboeye.assistive.depthprobe.uitests; GENERATE_INFOPLIST_FILE = YES; TEST_TARGET_NAME = AssistiveDepthProbe; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @loader_path/Frameworks";');
const projectConfigs=configs('project','');
const proxy=add('proxy',`isa = PBXContainerItemProxy; containerPortal = ${id('project')}; proxyType = 1; remoteGlobalIDString = ${id('app')}; remoteInfo = AssistiveDepthProbe;`);
const dependency=add('dependency',`isa = PBXTargetDependency; target = ${id('app')}; targetProxy = ${proxy};`);
add('app',`isa = PBXNativeTarget; buildConfigurationList = ${appConfigs}; buildPhases = (${appSources},${resources}); buildRules = (); dependencies = (); name = AssistiveDepthProbe; productName = AssistiveDepthProbe; productReference = ${appProduct}; productType = "com.apple.product-type.application";`);
add('test',`isa = PBXNativeTarget; buildConfigurationList = ${testConfigs}; buildPhases = (${testSources}); buildRules = (); dependencies = (${dependency}); name = ProbeUITests; productName = ProbeUITests; productReference = ${testProduct}; productType = "com.apple.product-type.bundle.ui-testing";`);
add('project',`isa = PBXProject; attributes = { LastUpgradeCheck = 2700; TargetAttributes = { ${id('test')} = { TestTargetID = ${id('app')}; }; }; }; buildConfigurationList = ${projectConfigs}; compatibilityVersion = "Xcode 14.0"; developmentRegion = vi; hasScannedForEncodings = 0; knownRegions = (vi,en,Base); mainGroup = ${group}; productRefGroup = ${products}; projectDirPath = ""; projectRoot = ""; targets = (${id('app')},${id('test')});`);
fs.mkdirSync(path.join(project,'xcshareddata/xcschemes'),{recursive:true});
fs.writeFileSync(path.join(project,'project.pbxproj'),`// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n${objects.join('\n')}\n}; rootObject = ${id('project')}; }\n`);
const ref=(key,name)=>`<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id(key)}" BuildableName="${name==='AssistiveDepthProbe'?'AssistiveDepthProbe.app':'ProbeUITests.xctest'}" BlueprintName="${name}" ReferencedContainer="container:AssistiveDepthProbe.xcodeproj"/>`;
fs.writeFileSync(path.join(project,'xcshareddata/xcschemes/AssistiveDepthProbe.xcscheme'),`<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${ref('app','AssistiveDepthProbe')}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${ref('test','ProbeUITests')}</TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="NO"><BuildableProductRunnable runnableDebuggingMode="0">${ref('app','AssistiveDepthProbe')}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${ref('app','AssistiveDepthProbe')}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>\n`);
console.log(`Generated native project (${appFiles.length} app sources, no dependencies).`);
