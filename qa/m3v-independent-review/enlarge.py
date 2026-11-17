"""QA-only enlargement of sealed fixed crops, no correspondence inference."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
Q = ROOT / 'native/ios/.build-xcode/scene-qa'
OUT = Path(__file__).resolve().parent
SP = Q / 'm3v-reference-source/source-selection.json'
TP = Q / 'm3v-reference-target/target-proposals.json'
SHA = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert SHA(SP) == 'a949bec984aebb13ecff5ea9603cd29a89fab865d109f6647075cdfca276455f'
assert SHA(TP) == '22a7486bf5fc14d6b31b2af4746765f9248011dc4fcf8f900dbad8126b93f298'
source, target = json.loads(SP.read_text()), json.loads(TP.read_text())
manifest = {'sourceSelectionSha256': SHA(SP), 'targetProposalsSha256': SHA(TP),
            'authority': 'QA display only; nearest enlargement of sealed fixed contexts/details; no new source pixels, predictors, matching, or annotations', 'plates': []}
for pair, current in zip(source['pairs'], target['pairs'], strict=True):
    panels = {p['slotId']: p for p in current['targetPanels']}
    for panel in pair['sourcePanels']:
        slot = panel['slotId']
        canvas = Image.new('RGB', (1100, 870), '#10171b')
        draw = ImageDraw.Draw(canvas)
        draw.text((20, 10), slot + ' | native coordinates; no predicted target; fixed context/detail only', fill='white')
        records = []
        for phase, p, parent, left in [('SOURCE', panel, SP.parent, 42), ('CURRENT', panels[slot], TP.parent, 588)]:
            raw = parent / p['rawContextPath']
            assert SHA(raw) == p['rawContextSha256']
            image = Image.open(raw).convert('RGB')
            assert image.size == (241, 241)
            rect = p['contextNativeRect']
            detail = p['detailNativeRect']
            draw.text((left, 34), phase + ' fixed context ' + str(rect), fill='white')
            canvas.paste(image, (left, 56))
            patch = image.crop((detail[0]-rect[0], detail[1]-rect[1], detail[2]-rect[0], detail[3]-rect[1]))
            assert patch.size == (81, 81)
            canvas.paste(patch.resize((486, 486), Image.Resampling.NEAREST), (left, 356))
            draw.text((left, 312), 'Fixed detail ' + str(detail) + ' nearest x6, unmarked pixels', fill='white')
            for x in range(((detail[0]+9)//10)*10, detail[2], 10):
                px = left + (x-detail[0])*6
                draw.line((px, 348, px, 355), fill='#ddc999')
                draw.text((px-10, 334), str(x), fill='#ddc999')
            for y in range(((detail[1]+9)//10)*10, detail[3], 10):
                py = 356 + (y-detail[1])*6
                draw.line((left-7, py, left-1, py), fill='#ddc999')
                draw.text((left-36, py-4), str(y), fill='#ddc999')
            records.append({'phase': phase, 'rawPath': str(raw), 'rawSha256': SHA(raw), 'contextNativeRect': rect,
                            'detailNativeRect': detail, 'detailDisplayOffset': [left, 356], 'detailDisplayScale': 6})
        path = OUT / (slot+'.png')
        canvas.save(path, compress_level=3)
        manifest['plates'].append({'slotId': slot, 'path': str(path), 'sha256': SHA(path), 'inputs': records})
assert len(manifest['plates']) == 72
(OUT/'display-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps({'plates': 72, 'manifest': str(OUT/'display-manifest.json'), 'sha256': SHA(OUT/'display-manifest.json'), 'pngBytes': sum(Path(p['path']).stat().st_size for p in manifest['plates'])}))
