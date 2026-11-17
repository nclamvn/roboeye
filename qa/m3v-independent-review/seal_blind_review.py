"""Serialize visually authored decisions; no pixel matching or geometry."""
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
Q=ROOT/'native/ios/.build-xcode/scene-qa'
S=Q/'m3v-reference-source/source-selection.json'
T=Q/'m3v-reference-target/target-proposals.json'
SHA=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert SHA(S)=='a949bec984aebb13ecff5ea9603cd29a89fab865d109f6647075cdfca276455f'
assert SHA(T)=='22a7486bf5fc14d6b31b2af4746765f9248011dc4fcf8f900dbad8126b93f298'
R=lambda a:dict(zip(('x0','y0','x1','y1'),a))
# All numerical rectangles below are reviewer-authored from native unmarked
# RGB displays. Wide bounds intentionally preserve visual uncertainty.
matches={
 (0,0):([418,278,424,284],[406,252,413,258],'Left lower corner of projecting white balcony face'),
 (0,1):([982,259,986,265],[990,239,995,248],'Small lower clamp beneath the middle rooftop antenna, not antenna-tip substitution'),
 (0,2):([1758,483,1764,490],[1760,470,1768,477],'Right lower corner of raised dark roof trim step; conditional physical trim vertex'),
 (0,3):([1864,539,1871,549],[1873,521,1881,531],'White fixed pole bracket at arm origin, blurred irregular edge'),
 (0,6):([1304,954,1311,961],[1306,944,1314,952],'Right end of fixed white crossarm on distant signal mast'),
 (0,10):([1812,1500,1819,1507],[1836,1517,1843,1524],'Same small dark paint-hole in white road arrow, not a new road corner'),
 (1,0):([337,162,349,177],[323,158,335,172],'Whole blurred dark facade attachment bounds; smaller material subcorner is not resolved'),
 (1,1):([1017,296,1024,303],[1016,301,1024,307],'Right end of middle horizontal rooftop antenna'),
 (1,3):([1968,470,1977,478],[1974,470,1983,478],'Lower right extremity of fixed pole-mounted camera housing'),
 (1,10):([1558,1368,1567,1376],[1562,1391,1572,1398],'Crack entry at left edge of white road stripe'),
 (2,0):([268,411,276,420],[260,410,268,420],'Upper part of dark facade attachment, distinct from shadow edge'),
 (2,3):([2059,373,2068,382],[2075,363,2084,373],'Middle small protruding clamp on fixed vertical mast'),
 (2,5):([844,817,852,826],[847,821,855,829],'Upper right corner of white vertical building trim at dark canopy edge'),
 (2,6):([1471,986,1480,996],[1479,990,1488,1001],'Bright fixed canopy/support lower corner, conditional rigid building feature'),
 (2,10):([1627,1463,1636,1471],[1654,1490,1664,1500],'Crack junction at right painted stripe edge'),
 (3,0):([244,421,251,428],[235,423,244,431],'Upper edge of same dark facade attachment'),
 (3,2):([1816,493,1823,501],[1822,485,1830,494],'Right lower corner of raised dark roof trim step; conditional physical trim vertex'),
 (3,10):([1733,1536,1743,1545],[1748,1547,1762,1562],'Dark branch junction in road-arrow crack graph, visibly blurred'),
 (4,0):([184,350,192,359],[177,362,184,371],'Lower edge of dark facade attachment'),
 (4,6):([1340,977,1348,985],[1356,975,1365,983],'Right end of fixed white crossarm on distant mast'),
 (4,10):([1808,1428,1816,1436],[1813,1436,1822,1445],'Same inward notch of white painted stripe at cracked edge'),
 (5,1):([883,602,891,610],[883,602,891,610],'Small fixed rooftop vent/cap lower right edge, unchanged within visual precision'),
}
unknowns={
 0:{4:'Vehicle front/headlamp, not established world-static.',5:'Vehicle wheel/body, not established world-static.',7:'Display/glass bright content could be reflection; selected blue-white spot is not an independently identified material corner.',8:'Own vehicle hood, excluded static-world reference.',9:'Own vehicle hood/dash, excluded static-world reference.',11:'Paint boundary is static but selected local point is an elongated/irregular edge; unique subcorner correspondence not resolved.'},
 1:{2:'Foreground roof edge occludes a background roof/white panel: apparent 2D intersection is not a unique material vertex.',4:'Vehicle body/headlamp, not established world-static.',5:'Vehicle wheel/body, not established world-static.',6:'Distant small bright structure near traffic, exact selected material point not resolved.',7:'Bright glass/display dot may be reflection; not a distinct fixed material corner.',8:'Own vehicle hood.',9:'Own vehicle hood/dash.',11:'Own vehicle hood clipped at image boundary.'},
 2:{1:'Bright triangular spots on multiple window panes could be reflections, not a verified material corner.',2:'Foreground roof/background roof occlusion intersection, not a verified same physical corner.',4:'Vehicle wheel/body, not established world-static.',7:'Selected text is on a flexible hanging banner; rigid/static-world point not established.',8:'Own vehicle hood.',9:'Own vehicle hood/reflection.',11:'Own vehicle hood.'},
 3:{1:'Bright window-pane glint repeats across windows and may be reflection, not a verified material corner.',3:'Slanted foreground roof intersects background white roof; apparent tip is a depth/occlusion junction.',4:'Passing vehicle door/handle, not world-static.',5:'Selected bright feature on distant traffic vehicle.',6:'Distant illuminated letters blurred; selected letter subcorner is not uniquely resolved.',7:'Hydrant round cap/specular contour has no uniquely identified same material subcorner.',8:'Own vehicle hood.',9:'Own vehicle hood/dash.',11:'Own vehicle hood.'},
 4:{1:'Window bright glint/reflection rather than a securely identified material corner.',2:'White gap tip is intersection of occluding roof edges at different depths, not a verified material vertex.',3:'Foreground roof edge crosses background white roof edge; 2D tip is not a material corner.',4:'Bright glass/door reflection; selected point not identified as static material.',5:'Selected feature overlaps bollard and car/headlamp at different depths; cannot certify selected material identity.',7:'Hydrant curved/specular feature; same material subcorner not resolved.',8:'Own vehicle hood.',9:'Own vehicle hood/dash.',11:'Own vehicle hood.'},
 5:{0:'Small attachment on suspended overhead wire could move/sway; static-world material point not established from these pixels.',2:'Bright gap/brace under billboard has ambiguous material boundary and reflected sky; selected same corner not resolved.',3:'Cable/building silhouette intersection is a depth junction, not one physical material feature.',4:'Walking person.',5:'Person/traffic overlap; selected point not static-world.',6:'Cable/bracket/beam apparent junction at separate depths; same material corner not established.',7:'Dark text very close to clipped native image edge; selected distinct material corner unresolved.',8:'Own vehicle hood.',9:'Brake-light reflection on own vehicle hood.',10:'Highlight/reflection on own vehicle hood.',11:'Own vehicle hood.'},
}
slots={}
for p in json.loads(S.read_text())['pairs']:
    i=int(p['id'][4:])
    for j,s in enumerate(p['slots']):
        if (i,j) in matches:
            a,b,identity=matches[i,j]
            slots[s['id']]=dict(status='accepted-static-match',sourceRectangle=R(a),targetRectangle=R(b),
                materialIdentity=identity,staticEvidence='Visually associated with fixed facade, street fixture or road marking; conditional on this visual interpretation, not physical certification.',
                reason='Independently identified on sealed RGB charts and unmarked fixed crops; deliberately wide native uncertainty where blurred.')
        else:slots[s['id']]=dict(status='unknown',reason=unknowns[i][j])
assert len(slots)==72
result=dict(schemaVersion=1,reviewer='Independent QA reviewer; AI-authored visual reference, not human/exact physical truth',
    inputSha256=json.loads(S.read_text())['inputSha256'],sourceSelectionSha256=SHA(S),targetProposalsSha256=SHA(T),
    displayManifestSha256=SHA(Path(__file__).parent/'display-manifest.json'),slots=slots,
    counts=dict(Counter(s['status']for s in slots.values())),
    review=dict(allOriginalSlotsReviewed=72,chartsReviewed=48,initialAnnotationFilesRead=False,
        modelOrGeometryOutputsSeen=False,sourceOnlySealVerifiedBeforeTargetView=True,
        limitations=['Two rectangle updates (pair0-cell00, pair2-cell00) and two proposed unknown identities (pair2-cell02, pair5-cell03) were disclosed in a parent coordination message before this final draft. These four are not claimed fully blind; all independently re-inspected.',
                    'All other initial annotation files remained unread. Rectangles are visual uncertainty regions, not probabilities or exact pixel groundtruth.',
                    'Roof-step and canopy interpretations are explicitly conditional; identity disagreement must become unknown rather than tuned to geometry.',
                    'No LK/RAFT/pose-projected endpoints or geometry outputs were used. No source replacement. M3U traffic score unchanged.']))
out=ROOT/'docs/evidence/tip65/m3v-independent-pixel-decisions.json'
assert not out.exists()
out.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(path=str(out),sha256=SHA(out),counts=result['counts'])))
