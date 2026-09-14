import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hudDistance,hudMode,highlightThreat,hudWarning,redThreat,playbackControl,type HudState} from '../../src/drive/hud';
import {assessRisk,type RiskTrack} from '../../src/drive/risk';
import {unknownRange} from '../../src/drive/geometry';
import type {DriveTrack} from '../../src/drive/tracking';

function threat(distanceM:number|null=12):RiskTrack {
  const track:DriveTrack={id:1,box:{label:'car',score:.97,x0:.4,x1:.6,y0:.5,y1:.75},ageMs:0,
    range:{...unknownRange('fixture'),distanceM,sigmaM:1,provenance:'user-profile-geometry'},
    closingSpeed:null,opticalTtcS:1.2,rangeTtcS:null,motionConfidence:.9,status:'tracked'};
  return assessRisk([track],{speedKph:80,adverse:false}).primary!;
}

test('minimal HUD publishes metres only and abstains on absent or invalid range',()=>{
  assert.equal(hudDistance({distanceM:23.4,provenance:'learned-unverified'}),'≈23 m*');
  assert.equal(hudDistance({distanceM:23.4,provenance:'user-profile-geometry'}),'≈23 m');
  for(const distanceM of [null,Number.NaN,Infinity,0,-1]){
    assert.equal(hudDistance({distanceM,provenance:'learned-unverified'}),'Chưa đo');
  }
});

test('only the primary warning target receives risk corner brackets',()=>{
  assert.equal(highlightThreat(1,1,'critical'),true);
  assert.equal(highlightThreat(1,1,'caution'),true);
  assert.equal(highlightThreat(2,1,'critical'),false);
  assert.equal(highlightThreat(1,1,'monitor'),false);
  assert.equal(highlightThreat(1,null,'clear'),false);
});

test('red HUD requires a fresh accepted high-risk target, including non-primary vehicles',()=>{
  const critical=threat();
  assert.equal(redThreat(critical),true);
  assert.equal(redThreat({...critical,track:{...critical.track,id:2}}),true);
  for(const patch of [{level:'caution' as const},{inPath:false},{confidence:.51},
    {confidence:Number.NaN},{ttcAgreement:'conflict' as const}]){
    assert.equal(redThreat({...critical,...patch}),false);
  }
  for(const ageMs of [-1,500,1000,Infinity,Number.NaN]){
    assert.equal(redThreat({...critical,track:{...critical.track,ageMs}}),false);
  }
  assert.equal(redThreat(null),false);
  assert.equal(redThreat(undefined),false);
});

test('proximity warning never substitutes optical approach for a measured gap',()=>{
  assert.equal(hudWarning(threat(),true),'Quá gần');
  assert.equal(hudWarning(threat(40),true),'Nguy cơ cao');
  for(const distanceM of [null,Number.NaN,Infinity,0,-1]){
    const optical=threat(null);
    assert.equal(hudWarning({...optical,track:{...optical.track,
      range:{...optical.track.range,distanceM}}},true),'Nguy cơ cao');
  }
  assert.equal(hudWarning(threat(),false),null); // reset or analysis in progress
  assert.equal(hudWarning({...threat(),level:'caution'},true),null);
  assert.equal(hudWarning({...threat(),ttcAgreement:'conflict'},true),null);
  assert.equal(hudWarning(null,true),null);
});

test('minimal HUD never mislabels synthetic or analysed playback as live sensing',()=>{
  const base:HudState={source:'none',loading:false,analysing:false,replayReady:false,hasRange:false};
  assert.equal(hudMode(base),'Chọn nguồn');
  assert.equal(hudMode({...base,source:'demo'}),'Mẫu dựng · không phải AI');
  assert.equal(hudMode({...base,source:'file',replayReady:true}),'Phát lại đã phân tích');
  assert.equal(hudMode({...base,source:'file',analysing:true}),'Đang phân tích');
  assert.equal(hudMode({...base,source:'camera',loading:true}),'Đang tải AI');
  assert.equal(hudMode({...base,source:'camera'}),'Camera · chưa đo mét');
});

test('playback affordance follows actual media state, including completion and reset',()=>{
  assert.deepEqual(playbackControl(true,false),{label:'Phát video',playing:false});
  assert.deepEqual(playbackControl(false,false),{label:'Tạm dừng video',playing:true});
  assert.deepEqual(playbackControl(false,true),{label:'Phát video',playing:false});
  assert.deepEqual(playbackControl(true,true),{label:'Phát video',playing:false});
});

test('analysis is closed by default, with all existing DOM targets unique and available',()=>{
  const html=readFileSync(new URL('../../drive.html',import.meta.url),'utf8');
  const details=html.match(/<details[^>]*id="analysis-panel"[^>]*>/)?.[0];
  assert.ok(details);
  assert.equal(/\bopen\b/.test(details),false);
  const ids=Array.from(html.matchAll(/\bid="([^"]+)"/g),match=>match[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['file','camera','enable-alerts','video','overlay','hud-warning','hud-warning-text','risk-console','calibration','track-list','analyse'])assert.ok(ids.includes(id));
  const panelOffset=html.indexOf(details);
  assert.ok(html.indexOf('id="file"')<panelOffset);
  assert.ok(html.indexOf('id="risk-console"')>panelOffset);
  assert.ok(html.indexOf('id="calibration"')>panelOffset);
  assert.match(html,/<div[^>]*id="hud-warning"[^>]*role="alert"[^>]*hidden>/);
});

test('single viewport shell contains video without cropping; warning respects reduced motion',()=>{
  const css=readFileSync(new URL('../../src/drive/drive.css',import.meta.url),'utf8');
  assert.match(css,/\.viewer\{min-width:0;width:100%\}/);
  assert.doesNotMatch(css,/--media-ratio|max-width:1760px|object-fit:cover/);
  assert.match(css,/\.stage\{[^}]*height:100svh;height:100dvh/);
  assert.match(css,/\.stage video,\.stage canvas\{[^}]*object-fit:contain/);
  assert.match(css,/#hud-warning-text\{animation:warning-pulse 4s ease-in-out infinite\}/);
  assert.match(css,/@keyframes warning-pulse\{0%,100%\{opacity:1\}50%\{opacity:\.88\}\}/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{#hud-warning-text\{animation:none\}\}/);
  assert.match(css,/\.proximity-warning\[hidden\]\{display:none\}/);
  assert.doesNotMatch(css,/\.topbar \.safety\{[^}]*display:none/);
});

test('edge-to-edge video contains its toolbar; icon controls retain accessible names',()=>{
  const html=readFileSync(new URL('../../drive.html',import.meta.url),'utf8');
  const stageStart=html.indexOf('id="stage"'),dockStart=html.indexOf('id="video-dock"');
  // Nested status/analysis sections must not be mistaken for the viewer end.
  const stageEnd=html.search(/<\/details>\s*<\/div>\s*<\/section>\s*<\/main>/);
  assert.ok(stageStart<dockStart&&dockStart<stageEnd);
  assert.ok(html.indexOf('<header class="topbar">')>stageStart);
  for(const id of ['file','camera','play','seek','time','enable-alerts','stop','fullscreen']){
    const tag=html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0];
    assert.ok(tag);
    assert.match(tag,/aria-label="[^"]+"/);
    assert.ok(html.indexOf(tag)>dockStart&&html.indexOf(tag)<stageEnd);
  }
  const css=readFileSync(new URL('../../src/drive/drive.css',import.meta.url),'utf8');
  assert.match(css,/\.workspace\{[^}]*margin:0;padding:0\}/);
  assert.match(css,/\.video-dock\{position:absolute;/);
  assert.doesNotMatch(css,/backdrop-filter/); // Avoid a per-frame video blur cost.
});

test('file processing feedback remains visible outside the collapsed analysis panel',()=>{
  const html=readFileSync(new URL('../../drive.html',import.meta.url),'utf8');
  const stageStart=html.indexOf('id="stage"'),noticeStart=html.indexOf('id="job-notice"'),panelStart=html.indexOf('id="analysis-panel"');
  assert.ok(stageStart<noticeStart&&noticeStart<panelStart);
  assert.match(html,/<section[^>]*id="job-notice"[^>]*aria-label="Trạng thái xử lý video"[^>]*hidden>/);
  assert.match(html,/<strong[^>]*id="job-title"[^>]*role="status"/);
  for(const id of ['job-title','job-detail','job-action','hud-progress'])assert.equal(html.match(new RegExp(`id="${id}"`,'g'))?.length,1);
  assert.match(html,/<progress[^>]*id="hud-progress"[^>]*aria-label="Tiến độ xử lý"/);
});

test('analysis is an in-video overlay with its own scroll surface and accessible close action',()=>{
  const html=readFileSync(new URL('../../drive.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../src/drive/drive.css',import.meta.url),'utf8');
  const stageStart=html.indexOf('id="stage"'),panelStart=html.indexOf('id="analysis-panel"');
  assert.ok(panelStart>stageStart);
  assert.match(html,/<\/details>\s*<\/div>\s*<\/section>\s*<\/main>/);
  assert.match(html,/<summary[^>]*aria-label="Phân tích"[^>]*aria-controls="analysis-surface"/);
  assert.match(html,/<button[^>]*id="close-analysis"[^>]*aria-label="Đóng phân tích"/);
  assert.match(css,/\.analysis-panel\{position:absolute;inset:0;/);
  assert.match(css,/\.analysis-scroll\{[^}]*overflow:auto;overscroll-behavior:contain/);
});

test('empty stage has one primary source action and no meaningless disabled transport row',()=>{
  const html=readFileSync(new URL('../../drive.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../src/drive/drive.css',import.meta.url),'utf8');
  assert.match(html,/id="stage" data-source="none"/);
  for(const id of ['open-video','open-camera','demo'])assert.ok(html.includes(`id="${id}"`));
  assert.doesNotMatch(html,/class="dock-label"/);
  assert.match(css,/\.stage:not\(\[data-source=file\]\) \.transport,\.stage:not\(\[data-source=file\]\) #play\{display:none\}/);
  assert.match(css,/\.stage\[data-source=none\] #stop,\.stage\[data-source=none\] #enable-alerts/);
});
