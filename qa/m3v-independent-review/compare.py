"""Compare sealed visual annotations, before any geometry results."""
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/evidence/tip65'
SHA=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
files={
 'firstContractor':('m3v-contractor-pixel-decisions.json','a4183d899a21e2b1cd91f0b35cc2d0a76e70b5b32fbf9cc8193a33ecead2c5f4'),
 'firstBuilder':('m3v-builder-pixel-decisions.json','53c506a7007b8f2cf07d210fc47382229037f4cc5d7b71b4e3a60cd87cc61031'),
 'independent':('m3v-independent-pixel-decisions.json','836f6925be79464408e4e50cfde571d4b01403f815b6708f287a2c985dcd46a6'),
}
loaded={}
for role,(name,sha)in files.items():
    path=E/name
    assert SHA(path)==sha
    loaded[role]=json.loads(path.read_text())
first={**loaded['firstContractor']['slots'],**loaded['firstBuilder']['slots']}
independent=loaded['independent'];assert set(first)==set(independent['slots'])and len(first)==72
identity_disagreements={
 'pair0-cell03':'Both recognize the same fixture, but source bracket elbow versus pole-arm origin and target vertical subcorner remain unresolved. Different subcorner cannot become a large uncertainty union.',
 'pair0-cell10':'Source dark paint-hole agreed, but target isolated spot versus nearby notch disagree by about18native pixels. Exact material point identity unresolved; do not union distinct features.',
 'pair1-cell00':'Reviewer only resolves whole blurred latch while first annotator specifies a terminal corner. Whole-object bounds do not independently verify that selected material corner.',
 'pair1-cell10':'Source crack-entry agreed, but target left stripe-edge entry and right crack tip are different corners about32native pixels apart. Unknown, not averaged/unioned.',
}
slots={};comparisons={}
for key,b in independent['slots'].items():
    a=first[key]
    if key in identity_disagreements:
        out=dict(status='unknown',reason=identity_disagreements[key]);decision='subcorner-identity-disagreement-unknown'
    elif a['status']!=b['status']:
        out=dict(status='unknown',reason='At least one visual reviewer cannot establish selected static material identity. First: '+a['reason']+' Independent: '+b['reason'])
        decision='one-sided-unknown-retained'
    elif a['status']=='unknown':
        out=dict(status='unknown',reason='Both visual reviewers abstain. First: '+a['reason']+' Independent: '+b['reason']);decision='both-unknown'
    else:
        out=dict(status='accepted-static-match',sameSelectedFeature=True,
            reason='Both independently identify the same selected material subcorner; union of native uncertainty bounds, never averaging toward geometry.',
            materialIdentity=a['materialIdentity'],staticEvidence=a['staticEvidence'],
            independentMaterialInterpretation=b['materialIdentity'])
        for field in ('sourceRectangle','targetRectangle'):
            out[field]={x:(min if x.endswith('0')else max)(a[field][x],b[field][x])for x in('x0','y0','x1','y1')}
        decision='same-selected-point-uncertainty-union'
    slots[key]=out;comparisons[key]=dict(recommendation=decision,first=a,independent=b,proposed=out)
counts=dict(Counter(x['status']for x in slots.values()))
result=dict(schemaVersion=1,study='M3V-independent-visual-crosscomparison',
    sourceSelectionSha256=independent['sourceSelectionSha256'],targetProposalsSha256=independent['targetProposalsSha256'],
    inputSha256=independent['inputSha256'],annotationFiles={r:dict(path=str(E/n),sha256=s)for r,(n,s)in files.items()},
    originalSlots=72,counts=counts,recommendationCounts=dict(Counter(c['recommendation']for c in comparisons.values())),
    comparisons=comparisons,slots=slots,
    review=dict(authority='Independent visual cross-review, AI-authored conditional uncertainty reference, not exact physical/human truth.',
        geometryResultsSeen=False,originalSourceSlotsUnchanged=True,noAutomaticPromotion=True,
        firstAnnotationsReadOnlyAfterIndependentDraftSeal=True,
        leakage=independent['review']['limitations'][0],
        disposition='Proposed final annotations require Contractor approval before bind and single diagnostic run. No runtime, M3U score or quality-floor change.'))
path=E/'m3v-independent-pixel-crosscomparison.json';assert not path.exists();path.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(path=str(path),sha256=SHA(path),counts=counts,recommendationCounts=result['recommendationCounts'])))
