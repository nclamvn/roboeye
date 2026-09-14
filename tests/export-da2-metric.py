"""Reproducible R1 export from author-hosted safetensors, never relative weights.
Fixed-shape A/B fixture only. No remote Python code executed. Export stays outside public/.
"""
from pathlib import Path
import json, hashlib, urllib.request
import torch
import numpy as np
import onnxruntime as ort
from transformers import DepthAnythingForDepthEstimation

root=Path(__file__).resolve().parents[1]
cache=root/'tests/.metric-cache'
source=cache/'da2-source'
source.mkdir(parents=True,exist_ok=True)
model_id='depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf'
revision='fd2c22027eaf20374204f14099b8341e1925ad39'
source_hash='ad065c77a7421ca55159a1f0db9433397a607690f2d76bb8a6fc54b1be7a3124'
for name in ['config.json','preprocessor_config.json','model.safetensors']:
    target=source/name
    if not target.exists():
        print('Downloading pinned',name,flush=True)
        urllib.request.urlretrieve(f'https://huggingface.co/{model_id}/resolve/{revision}/{name}',target)
assert hashlib.sha256((source/'model.safetensors').read_bytes()).hexdigest()==source_hash
config=json.loads((source/'config.json').read_text())
assert config['depth_estimation_type']=='metric' and config['max_depth']==80
model=DepthAnythingForDepthEstimation.from_pretrained(str(source),local_files_only=True).eval()
class Wrapper(torch.nn.Module):
    def __init__(self):
        super().__init__(); self.model=model
        self.register_buffer('mean',torch.tensor([.485,.456,.406]).reshape(1,3,1,1))
        self.register_buffer('std',torch.tensor([.229,.224,.225]).reshape(1,3,1,1))
    def forward(self,image):
        return self.model(pixel_values=(image-self.mean)/self.std).predicted_depth
wrapper=Wrapper().eval()
meta=json.loads((cache/'reference.json').read_text())
height,width=meta['height'],meta['width']
rgb=np.fromfile(cache/'input.bin',dtype='<f4').reshape(1,3,height,width)
image=torch.from_numpy(rgb)
with torch.no_grad():
    expected=wrapper(image).numpy()
    torch.onnx.export(wrapper,(image,),str(cache/'da2-metric.onnx'),input_names=['image'],output_names=['depth_metres'],opset_version=17,dynamo=False)
session=ort.InferenceSession(str(cache/'da2-metric.onnx'),providers=['CPUExecutionProvider'])
actual=session.run(None,{'image':rgb})[0]
error=float(np.max(np.abs(actual-expected)))
assert error<.01, error
expected.astype('<f4').tofile(cache/'da2-depth.bin')
manifest={'id':model_id,'revision':revision,'sourceWeightsSha256':source_hash,
          'sha256':hashlib.sha256((cache/'da2-metric.onnx').read_bytes()).hexdigest(),
          'bytes':(cache/'da2-metric.onnx').stat().st_size,'width':width,'height':height,
          'unit':'metres','distanceKind':'optical-axis-z','input':'RGB NCHW float32 [0,1], normalization inside graph',
          'output':'depth_metres [1,H,W]','torchVersion':torch.__version__,'opset':17,
          'nativeExportMaxAbsM':error,'scope':'Fixed shape A/B lab fixture. Not production or distance-ground-truth validated.'}
(cache/'da2-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2),flush=True)
