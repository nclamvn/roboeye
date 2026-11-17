"""Display native-coordinate rulers for assigned blind secondary units07..13."""
from pathlib import Path
from hashlib import sha256
import json
import cv2
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
Q=ROOT/'native/ios/.build-xcode/scene-qa/boreas-m3u-secondary-review'
raw=(Q/'proposals.json').read_bytes();r=json.loads(raw)
for number in range(7,14):
 u=r['units'][number];panels=[]
 for a,f in zip(u['panels'],u['triple'],strict=True):
  p=Q/a['path'];assert sha256(p.read_bytes()).hexdigest()==a['sha256']
  original=Path(r['sourceRoot'])/f['path'];assert sha256(original.read_bytes()).hexdigest()==f['sha256']
  im=cv2.imread(str(original));x,y,z,b=a['nativeCrop'];im=im[y:b,x:z]
  h,w=im.shape[:2];assert [w,h]==a['size']and a['scale']==1
  im=cv2.resize(im,(w*4,h*4),interpolation=cv2.INTER_NEAREST)
  canvas=np.zeros((840,720,3),np.uint8);canvas[50:50+h*4,50:50+w*4]=im
  cv2.putText(canvas,a['role']+' origin '+str(a['nativeCrop'][:2]),(10,25),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),1)
  for x in range(0,w,10):cv2.putText(canvas,str(x),(50+x*4,45),cv2.FONT_HERSHEY_SIMPLEX,.4,(255,255,255),1)
  for y in range(0,h,10):cv2.putText(canvas,str(y),(8,54+y*4),cv2.FONT_HERSHEY_SIMPLEX,.4,(255,255,255),1)
  panels.append(canvas)
 sheet=np.concatenate(panels,axis=1)
 assert cv2.imwrite(str(Path(__file__).parent/f'secondary-{number:02d}.jpg'),sheet)
print(sha256(raw).hexdigest())
