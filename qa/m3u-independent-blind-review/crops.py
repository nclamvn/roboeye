"""Source-bound native ambiguity crops; no inference, labels or model outputs."""
from pathlib import Path
from hashlib import sha256
import json
import cv2
ROOT=Path(__file__).resolve().parents[2]
Q=ROOT/'native/ios/.build-xcode/scene-qa'
IP=Q/'boreas-m3u/input.json';inp=json.loads(IP.read_text());asset=(IP.parent/inp['assetRoot']).resolve()
rows=json.loads((Q/'boreas-m3u-review/candidates.json').read_text())['rows']
frames={f['token']:f for c in inp['clips']for f in c['frames']}
requested=[('boreas-m3u-turn-05','right-shadow',(620,380,770,490)),
 ('boreas-m3u-turn-05','distant-left',(285,385,405,445)),
 ('boreas-m3u-turn-05','behind-suv',(420,370,565,440)),
 ('boreas-m3u-city-08','far-behind-sedan',(410,350,535,430))]
result=[]
for key,name,box in requested:
 row=next(v for v in rows if v['key']==key);f=frames[row['token']];p=asset/f['path']
 assert sha256(p.read_bytes()).hexdigest()==f['sha256']
 image=cv2.imread(str(p),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION);h,w=image.shape[:2]
 x,y,z,b=[round(v*s)for v,s in zip(box,(w/960,h/803,w/960,h/803))]
 path=Path(__file__).parent/(key+'-'+name+'.png');assert cv2.imwrite(str(path),image[y:b,x:z])
 result.append(dict(path=str(path),sha256=sha256(path.read_bytes()).hexdigest(),sourceSha256=f['sha256'],token=f['token'],nativeCrop=[x,y,z,b]))
(Path(__file__).parent/'source-crops.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
