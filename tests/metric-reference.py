"""Independent CPU graph + scipy focal/shift objective for browser parity.
Never a ground-truth distance benchmark. Uses the public bus fixture, not user video.
Run with tests/.metric-venv/bin/python tests/metric-reference.py.
"""
from pathlib import Path
import json
import hashlib
import time
import numpy as np
from PIL import Image
from scipy.optimize import least_squares
import onnxruntime as ort

root = Path(__file__).resolve().parents[1]
model = root / 'tests/.metric-cache/moge-small.onnx'
assert hashlib.sha256(model.read_bytes()).hexdigest() == '24eacb5dc7a2c54c7bc98f7de085ffbed79ad006ea5b664c2c2cdc02ff3a52f0'
out = root / 'tests/.metric-cache'
out.mkdir(exist_ok=True)
width, height, tokens = 224, 280, 400
image = Image.open(root / 'tests/.detection-benchmark-cache/bus.jpg').convert('RGB').resize((width, height), Image.Resampling.BILINEAR)
rgb = np.asarray(image, dtype=np.float32).transpose(2, 0, 1)[None] / 255
rgb.astype('<f4').tofile(out / 'input.bin')
start = time.perf_counter()
session = ort.InferenceSession(str(model), providers=['CPUExecutionProvider'])
print('INPUTS', [(i.name, i.shape, i.type) for i in session.get_inputs()], flush=True)
result = dict(zip([o.name for o in session.get_outputs()], session.run(None, {'image': rgb, 'num_tokens': np.asarray(tokens, dtype=np.int64)})))
elapsed = (time.perf_counter()-start)*1000
points = result['points'][0].astype(np.float64)
mask = result['mask'].reshape(points.shape[:2]) > .5
assert set(result) == {'points', 'normal', 'mask', 'scale'}
scale = float(result['scale'].reshape(-1)[0])
h, w = points.shape[:2]
ys, xs = np.mgrid[:h, :w]
uv = np.stack(((2*xs+1-w)/np.hypot(w,h), (2*ys+1-h)/np.hypot(w,h)), -1).reshape(-1,2)
indices = np.arange(0,w*h,max(1,int(np.ceil(w*h/4096))))
indices = indices[mask.reshape(-1)[indices]]
xyz, uv = points.reshape(-1,3)[indices], uv[indices]

# Independent scipy implementation of upstream variable-projection objective.
def residual(shift):
    projected = xyz[:,:2]/(xyz[:,2]+shift[0])[:,None]
    focal = np.sum(projected*uv)/np.sum(projected**2)
    return (focal*projected-uv).ravel()

solution = least_squares(residual, [0.0], method='lm', ftol=1e-10, xtol=1e-10, gtol=1e-10)
shift = float(solution.x[0])
projected = xyz[:,:2]/(xyz[:,2]+shift)[:,None]
focal = float(np.sum(projected*uv)/np.sum(projected**2))
depth = (points[:,:,2]+shift)*scale
valid = mask & np.isfinite(depth) & (depth>0)
depth[~valid] = np.nan
depth.astype('<f4').tofile(out / 'depth.bin')
metadata = {'width':width,'height':height,'tokens':tokens,'outputWidth':w,'outputHeight':h,
            'focal':focal,'shift':shift,'scale':scale,'solverSuccess':bool(solution.success),
            'reprojectionRmse':float(np.sqrt(np.mean(residual([shift])**2))),
            'nativeSessionAndRunMs':elapsed,'onnxruntimeVersion':ort.__version__,
            'inputSha256':hashlib.sha256((out/'input.bin').read_bytes()).hexdigest(),
            'note':'CPU graph + scipy reference, not browser latency, not real metres ground truth.'}
(out/'reference.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2),flush=True)
