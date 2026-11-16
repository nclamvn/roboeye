"""Read-only replay boundaries, not recognition or iPhone quality tests."""

from copy import deepcopy
from importlib.util import module_from_spec, spec_from_file_location
import http.client
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location("scene_review", ROOT/"scripts/serve-assist-scene-review.py")
review = module_from_spec(SPEC)
SPEC.loader.exec_module(review)


def fixture(root, image_name="image.jpg"):
    image = root/image_name
    Image.new("RGB", (320,200), (90,110,130)).save(image)
    sha = review.digest(image.read_bytes())
    clips = []
    receipts = []
    for c in range(2):
        original = []
        frames = []
        for i in range(4):
            token = f"clip-{c}-{i}"
            stamp = 1_000_000 + i*80_000
            original.append({"token":token,"timestampUs":stamp,"path":image_name,"sha256":sha})
            surface = {"epoch":0,"status":"valid","tracks":[{"id":1,"label":"car","score":.8,
                       "box":{"x":.2,"y":.3,"width":.3,"height":.2}}],"events":[],
                       "answers":{"distance":{"metres":None}},"diagnostics":{"trackReasons":{"1":"no-current-expansion"}}}
            frames.append({"token":token,"timestampUs":stamp,"timeMs":i*80.,"width":320,"height":200,
                           "nativeWidth":320,"nativeHeight":200,"A":deepcopy(surface),"B":deepcopy(surface),"timingsMs":{"A":2.}})
        clips.append({"id":f"clip-{c}","frames":original})
        receipts.append({"id":f"clip-{c}","frames":frames})
    inp = root/"input.json"
    inp.write_text(json.dumps({"schemaVersion":1,"dataset":"Boreas-real","clips":clips}))
    rec = root/"receipt.json"
    rec.write_text(json.dumps({"schemaVersion":1,"dataset":"Boreas-real","inputSha256":review.digest(inp.read_bytes()),"clips":receipts}))
    return inp,rec


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="codex-tmp-assist-review-20261116-")
        self.root = Path(self.temp.name)
        self.inputs,self.receipt = fixture(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_validated_preview_caps_cache_and_exposes_no_source_path(self):
        data = review.ReviewData(self.inputs,self.receipt)
        self.assertNotIn(str(self.root),json.dumps(data.public))
        for i in range(4):
            self.assertTrue(data.thumbnail(0,i).startswith(b"\xff\xd8"))
        self.assertEqual(len(data.cache),2)
        for c,f in ((-1,0),(0,-1),(2,0),(0,4)):
            with self.assertRaises(KeyError): data.thumbnail(c,f)

    def test_png_verify_precedes_exif_metadata_loading(self):
        inputs,receipt=fixture(self.root,"image.png")
        data=review.ReviewData(inputs,receipt)
        self.assertTrue(data.thumbnail(0,0).startswith(b"\xff\xd8"))

    def test_wrong_receipt_clock_or_source_hash_fails_before_serving(self):
        initial = json.loads(self.receipt.read_text())
        for kind in ("input", "clock", "token", "metres", "ttc"):
            with self.subTest(kind=kind):
                rec=deepcopy(initial)
                if kind=="input": rec["inputSha256"]="changed"
                if kind=="clock": rec["clips"][0]["frames"][0]["timeMs"]=1
                if kind=="token": rec["clips"][0]["frames"][0]["token"]="wrong"
                if kind=="metres": rec["clips"][0]["frames"][0]["B"]["answers"]["distance"]["metres"]=1.
                if kind=="ttc": rec["clips"][0]["frames"][0]["B"]["tracks"][0]["ttc"]=2.
                self.receipt.write_text(json.dumps(rec))
                with self.assertRaises(ValueError): review.ReviewData(self.inputs,self.receipt)
        self.receipt.write_text(json.dumps(initial))
        (self.root/"image.jpg").write_bytes(b"changed")
        with self.assertRaises(ValueError): review.ReviewData(self.inputs,self.receipt)

    def test_manifest_path_traversal_rejected_even_when_receipt_rebound(self):
        original=json.loads(self.inputs.read_text())
        for path in ("../image.jpg", "/etc/passwd"):
            with self.subTest(path=path):
                source=deepcopy(original); source["clips"][0]["frames"][0]["path"]=path
                self.inputs.write_text(json.dumps(source))
                rec=json.loads(self.receipt.read_text()); rec["inputSha256"]=review.digest(self.inputs.read_bytes())
                self.receipt.write_text(json.dumps(rec))
                with self.assertRaises(ValueError):review.ReviewData(self.inputs,self.receipt)

    def test_actual_loopback_http_has_no_directory_or_mutation_endpoints(self):
        data=review.ReviewData(self.inputs,self.receipt)
        server=review.create_server(data,0)
        thread=Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            conn=http.client.HTTPConnection("127.0.0.1",server.server_port,timeout=3)
            for path,status in (("/",200),("/api/data",200),("/frame/0/0.jpg",200),
                                ("/frame/0/999.jpg",404),("/../../etc/passwd",404),("/frame/0/0.jpg?other=1",404)):
                conn.request("GET",path); response=conn.getresponse(); body=response.read()
                self.assertEqual(response.status,status,path)
                self.assertEqual(response.getheader("Cross-Origin-Resource-Policy"),"same-origin")
                if path=="/":self.assertIn("Không dẫn đường".encode(),body)
            conn.request("GET","/api/data",headers={"Origin":"https://evil.example"})
            self.assertEqual(conn.getresponse().status,403);conn.close()
            conn=http.client.HTTPConnection("127.0.0.1",server.server_port,timeout=3)
            conn.request("GET","/api/data",headers={"Sec-Fetch-Site":"cross-site"})
            response=conn.getresponse();response.read();self.assertEqual(response.status,403);conn.close()
            conn=http.client.HTTPConnection("127.0.0.1",server.server_port,timeout=3)
            conn.request("POST","/api/data",body=b"{}")
            response=conn.getresponse();response.read();self.assertEqual(response.status,405);conn.close()
        finally:
            server.shutdown();server.server_close();thread.join(timeout=3)
