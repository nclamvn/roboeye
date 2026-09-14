"""Fixed-shape equivalent RT-DETR graph for ORT WebGPU 1.22 AveragePool.

Never drop operators or reduce resolution. The ceil -> floor change is permitted
only where both output size and pooling samples coincide, proven at 640x640.
Native ORT original vs derived logits/boxes must pass on independent fixtures.
"""
from pathlib import Path
import hashlib, json, math
import onnx
from onnx import shape_inference, helper
import numpy as np
import onnxruntime as ort

root=Path(__file__).resolve().parents[1]
cache=root/'tests/.drive-cache'
source=cache/'rtdetr.onnx'
if not source.exists():
    import urllib.request
    cache.mkdir(parents=True,exist_ok=True)
    urllib.request.urlretrieve('https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/resolve/936f90b6a476c6da4dfe053fc521af55285976ba/onnx/model.onnx',source)
assert hashlib.sha256(source.read_bytes()).hexdigest()=='583a236ac21c95a7fd94f284fc21485e42355bfef82c27011ba78fbc09ee87e2'
model=onnx.load(source)
dims=model.graph.input[0].type.tensor_type.shape.dim
for i,n in [(0,1),(1,3),(2,640),(3,640)]: dims[i].dim_value=n
model=shape_inference.infer_shapes(model)
shapes={v.name:[d.dim_value for d in v.type.tensor_type.shape.dim]
        for v in list(model.graph.value_info)+list(model.graph.input)}
changes=[]
for node in model.graph.node:
    if node.op_type!='AveragePool': continue
    attrs={a.name:helper.get_attribute_value(a) for a in node.attribute}
    if attrs.get('ceil_mode',0)!=1: continue
    shape=shapes[node.input[0]]
    assert len(shape)==4 and all(shape)
    kernel=attrs['kernel_shape']; strides=attrs['strides']; pads=attrs.get('pads',[0]*4)
    assert pads==[0]*4 and kernel==strides==[2,2],attrs
    assert all((n-k)%s==0 and math.ceil((n-k)/s)==math.floor((n-k)/s)
               for n,k,s in zip(shape[2:],kernel,strides))
    for attr in node.attribute:
        if attr.name=='ceil_mode': attr.i=0
    changes.append({'node':node.name,'inputShape':shape,'proof':'no padding; kernel=stride=2; dimensions even; identical windows'})
assert len(changes)==3
for output in model.graph.output: output.type.tensor_type.shape.dim[0].dim_value=1
onnx.checker.check_model(model)
target=cache/'rtdetr-r18-640-webgpu.onnx'
onnx.save(model,target)
options=ort.SessionOptions(); options.intra_op_num_threads=4
original=ort.InferenceSession(str(source),sess_options=options,providers=['CPUExecutionProvider'])
derived=ort.InferenceSession(str(target),sess_options=options,providers=['CPUExecutionProvider'])
rng=np.random.default_rng(47)
fixtures={'zero':np.zeros((1,3,640,640),dtype=np.float32),
          'random':rng.random((1,3,640,640),dtype=np.float32)}
try:
    from PIL import Image
    for name in ['bus','dog']:
        image=Image.open(root/f'tests/.detection-benchmark-cache/{name}.jpg').convert('RGB').resize((640,640),Image.Resampling.BILINEAR)
        fixtures[name]=np.asarray(image,dtype=np.float32).transpose(2,0,1)[None]/255
except ImportError: raise RuntimeError('Pillow is required for independent public image checks')
checks=[]
for name,pixels in fixtures.items():
    a=original.run(None,{'pixel_values':pixels});b=derived.run(None,{'pixel_values':pixels})
    errors=[float(np.max(np.abs(x-y))) for x,y in zip(a,b)]
    assert max(errors)<1e-4,(name,errors)
    checks.append({'fixture':name,'logitsMaxAbs':errors[0],'boxesMaxAbs':errors[1]})
manifest={'model':'onnx-community/rtdetr_v2_r18vd-ONNX','revision':'936f90b6a476c6da4dfe053fc521af55285976ba',
          'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
          'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,
          'inputShape':[1,3,640,640],'changes':changes,'nativeEquivalence':checks,
          'exportEnvironment':{'onnx':onnx.__version__,'onnxruntime':ort.__version__,'numpy':np.__version__},
          'license':'Apache-2.0','scope':'fixed 640-square only; no vehicle-distance accuracy validation'}
(cache/'drive-detector-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2),flush=True)
