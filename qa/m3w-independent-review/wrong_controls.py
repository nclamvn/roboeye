"""Verify stored wrong-endpoint geometry via reviewer's own arithmetic only."""
import ast
import json
import math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/evidence/tip65';Q=ROOT/'native/ios/.build-xcode/scene-qa'
own=ast.parse((Path(__file__).parent/'verify.py').read_text())
namespace=dict(np=np,W=640,H=480)
exec(compile(ast.Module(body=[x for x in own.body if isinstance(x,ast.FunctionDef)and x.name in('close','quality','gate_arrays')],type_ignores=[]),'<reviewer-functions-only>','exec'),namespace)
close,calc=namespace['close'],namespace['gate_arrays']
g=json.loads((Q/'m3w-controls-r1/controls.json').read_text());d=json.loads((E/'m3w-factor-evaluation-r1.json').read_text());o=json.loads((E/'m3w-rgb-observations-r1.json').read_text());K=np.array(g['K']);ik=np.linalg.inv(K)
gold={p['id']:p for p in g['pairs']};obs={p['id']:p for p in o['pairs']};checked=0;points=0
for row in d['pairs']:
    p=gold[row['id']];a=np.array(obs[row['id']]['controls']['sourceSeeds']);q=np.array(row['reference']['endpoints']);good=np.array(row['patch7SingleMaterial'])&(np.array(row['reference']['status'])=='visible')
    T0,T1=[np.array(p[k]['cameraToWorld'])for k in('source','target')];T=np.linalg.solve(T1,T0);R,t=T[:3,:3],T[:3,3]
    for control in row['wrongEndpointControls']:
        if control['component']is None:
            assert np.linalg.norm(t)<=1e-6;continue
        t=t/np.linalg.norm(t);X=np.array([[0,-t[2],t[1]],[t[2],0,-t[0]],[-t[1],t[0],0.]])
        F=ik.T@X@R@ik;line=np.c_[a,np.ones(len(a))]@F.T;norm=np.linalg.norm(line[:,:2],axis=1);safe=norm>1e-9
        unit=np.zeros((len(a),2));unit[safe]=line[safe,:2]/norm[safe,None]
        if control['direction']=='along':unit=np.c_[-unit[:,1],unit[:,0]]
        b=q+8*unit;valid=good&safe&np.isfinite(b).all(axis=1)&(b[:,0]>=0)&(b[:,0]<640)&(b[:,1]>=0)&(b[:,1]<480)
        assert valid.sum()==control['eligibleWrongPoints'];close(np.linalg.norm((b-q)[valid],axis=1),np.full(valid.sum(),8.));points+=int(valid.sum())
        val=calc(a,b,valid,K,T0,T1);evidence=control['component']['evidence']
        for key,value in val.items():
            if isinstance(value,dict):
                for field,num in value.items():close(num,evidence[key][field])
            else:close(value,evidence[key])
        checked+=1
assert checked==20
print(json.dumps(dict(independentWrongGateArrayChecks=checked,eligibleWrongPointControls=points,newFlowOrModelCalls=0)))
