"""Local candidate only. Does not overwrite public pins or select production models."""
from pathlib import Path
import hashlib, json, importlib.metadata, argparse
import onnx

parser = argparse.ArgumentParser()
parser.add_argument('--converter', choices=['common', 'ort'], default='ort')
args = parser.parse_args()
if args.converter == 'ort':
    from onnxruntime.transformers.float16 import convert_float_to_float16
    from onnxruntime.transformers.onnx_model import OnnxModel
else:
    from onnxconverter_common.float16 import convert_float_to_float16

root = Path(__file__).resolve().parents[1]
out = root / 'tests/.metric-cache'
pins = {
    '392x224': 'dc868d88c5b97570f59863641092f7a517b85ef567de883a988d7df0e8b7250f',
    '224x392': '102c3b87a5610f57b7c337e0e7364d774b4648d5d6e2fb2cba6ed11fe60b6710',
}
manifests = []
for shape, sha in pins.items():
    source = root / f'public/models/drive-metric/da2-outdoor-{shape}.onnx'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == sha
    graph = convert_float_to_float16(onnx.load(source), keep_io_types=True)
    if args.converter == 'ort':
        # The official ORT converter inserts casts at the end; sort the DAG
        # with its own helper before full type/shape validation. No operator removal.
        OnnxModel(graph).topological_sort()
        onnx.checker.check_model(graph, full_check=True)
    else:
        # Retained reproduction of the common-converter Cast mismatch. This
        # structural check alone did NOT prove runtime/type validity in r2.
        onnx.checker.check_model(graph)
    target = out / f'da2-outdoor-{shape}-fp16-candidate.onnx'
    onnx.save(graph, target)
    manifest = {'shape': shape, 'sourceSha256': sha,
        'candidateSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'bytes': target.stat().st_size, 'keepIoTypes': True,
        'converter': args.converter,
        'converterVersion': importlib.metadata.version('onnxruntime' if args.converter == 'ort' else 'onnxconverter-common'),
        'scope': 'local numerical/performance candidate, not promoted or physical accuracy evidence'}
    manifests.append(manifest)
    print(json.dumps(manifest), flush=True)
(out / 'da2-fp16-candidates.json').write_text(json.dumps(manifests, indent=2) + '\n')
