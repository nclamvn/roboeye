"""Export pinned DA2 Metric Outdoor Small for a fixed landscape browser contract.

The source weights are the same verified artifact used by TIP-44. Normalization is
inside the graph. The static 392x224 shape is a multiple of the DINOv2 patch size
and is close to 16:9; application preprocessing letterboxes without stretching.
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

height,width=224,392
# Fixed deterministic fixture: gradient exposes channel/order and spatial mistakes.
y,x=np.mgrid[0:height,0:width].astype(np.float32)
rgb=np.stack((x/max(1,width-1),y/max(1,height-1),(.35+.3*x/max(1,width-1))),axis=0)[None]
image=torch.from_numpy(rgb)
wrapper=Wrapper().eval()
target=cache/'da2-drive-392x224.onnx'
with torch.no_grad(): expected=wrapper(image).numpy()
torch.onnx.export(wrapper,(image,),str(target),input_names=['image'],output_names=['depth_metres'],opset_version=17,dynamo=False)
session=ort.InferenceSession(str(target),providers=['CPUExecutionProvider'])
actual=session.run(None,{'image':rgb})[0]
error=float(np.max(np.abs(actual-expected)))
assert error<.01,error
manifest={'id':model_id,'revision':revision,
          'sourceWeightsSha256':source_hash,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
          'bytes':target.stat().st_size,'width':width,'height':height,'maxDepthM':80,
          'unit':'metres','distanceKind':'optical-axis-z',
          'input':'RGB NCHW float32 [0,1], normalization inside graph',
          'output':'depth_metres [1,H,W]','torchVersion':torch.__version__,'opset':17,
          'nativeExportMaxAbsM':error,
          'scope':'Fixed landscape browser PoC. Learned metric is not vehicle-distance ground-truth validated.'}
(cache/'da2-drive-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2),flush=True)
