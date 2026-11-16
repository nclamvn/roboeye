#!/usr/bin/env python3
"""Read-only loopback review of recorded Mac A/B receipts, not a live camera."""

import argparse
from collections import OrderedDict
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import BytesIO
import json
import math
from pathlib import Path
import re
from threading import Lock

from PIL import Image, ImageOps


MAX_INPUT = 2 * 1024**2
MAX_RECEIPT = 24 * 1024**2
MAX_ASSET = 8 * 1024**2
LABEL = re.compile(r"[a-z0-9][a-z0-9 -]{0,39}\Z")
FRAME_ROUTE = re.compile(r"/frame/(0|[1-9]\d{0,2})/(0|[1-9]\d{0,2})\.jpg\Z")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path, budget):
    if not path.is_file() or path.stat().st_size > budget:
        raise ValueError("Missing or over-budget manifest/receipt")
    raw = path.read_bytes()
    def fail(value):
        raise ValueError("Nonfinite JSON number")
    value = json.loads(raw, parse_constant=fail)
    if not isinstance(value, dict):
        raise ValueError("Expected JSON mapping")
    return raw, value


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate_box(box):
    if not isinstance(box, dict) or set(box) != {"x", "y", "width", "height"}:
        raise ValueError("Invalid normalized box")
    x, y, w, h = (box[key] for key in ("x", "y", "width", "height"))
    if (not all(number(v) and 0 <= v <= 1 for v in (x,y,w,h)) or min(w,h) <= 0
            or x+w > 1.000001 or y+h > 1.000001):
        raise ValueError("Invalid normalized box geometry")


def reject_metric_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in {"metres", "meters", "distance", "ttc", "timetocollision"}:
                raise ValueError("Review lane must not claim metric distance or TTC")
            reject_metric_keys(child)
    elif isinstance(value, list):
        for child in value:
            reject_metric_keys(child)


def clean_lane(lane, at):
    if not isinstance(lane, dict) or lane.get("answers", {}).get("distance") != {"metres": None}:
        raise ValueError("Only explicit null metres are allowed")
    if type(lane.get("epoch")) is not int or lane["epoch"] < 0 or not isinstance(lane.get("status"), str):
        raise ValueError("Invalid lane epoch/status")
    tracks, events = lane.get("tracks"), lane.get("events")
    if not isinstance(tracks, list) or len(tracks) > 12 or not isinstance(events, list) or len(events) > 12:
        raise ValueError("Unbounded tracks/events")
    known = {}
    for t in tracks:
        if (not isinstance(t, dict) or type(t.get("id")) is not int or t["id"] in known
                or not isinstance(t.get("label"), str) or not LABEL.fullmatch(t["label"])
                or not number(t.get("score")) or not 0 <= t["score"] <= 1):
            raise ValueError("Malformed or duplicate track")
        reject_metric_keys(t)
        validate_box(t.get("box"))
        known[t["id"]] = t["label"]
    event_ids = set()
    for event in events:
        reject_metric_keys(event)
        if (event.get("kind") != "relative-optical-approach" or event.get("timeMs") != at
                or event.get("epoch") != lane["epoch"] or known.get(event.get("trackId")) != event.get("label")
                or event.get("trackId") in event_ids or lane["status"] != "valid"):
            raise ValueError("Unsupported, stale or repeated event")
        event_ids.add(event["trackId"])
    reasons = lane.get("diagnostics", {}).get("trackReasons", {})
    if not isinstance(reasons, dict):
        raise ValueError("Invalid track reasons")
    return {"status": lane["status"], "tracks": tracks, "events": events,
            "reasons": {str(k)[:30]: str(v)[:120] for k,v in list(reasons.items())[:12]}}


class ReviewData:
    """Verify inputs before serving; only allowlisted source images are exposed."""

    def __init__(self, inputs, receipt):
        inputs, receipt = Path(inputs).resolve(strict=True), Path(receipt).resolve(strict=True)
        raw, source = read_json(inputs, MAX_INPUT)
        _, result = read_json(receipt, MAX_RECEIPT)
        if source.get("schemaVersion") != 1 or result.get("schemaVersion") != 1 or result.get("inputSha256") != digest(raw):
            raise ValueError("Receipt is not bound to this input manifest")
        if source.get("dataset") not in {"Boreas-real", "synthetic-m3c"} or result.get("dataset") != source["dataset"]:
            raise ValueError("Unexpected dataset")
        root = (inputs.parent / source.get("assetRoot", ".")).resolve(strict=True)
        clips, recorded = source.get("clips"), result.get("clips")
        if (not isinstance(clips, list) or not 2 <= len(clips) <= 5 or not isinstance(recorded, list)
                or [c.get("id") for c in clips] != [c.get("id") for c in recorded]
                or len({c.get("id") for c in clips}) != len(clips)):
            raise ValueError("Wrong or duplicate clip set")
        if sum(len(c.get("frames", [])) for c in clips) > 240:
            raise ValueError("Review frame budget exceeded")
        self.assets = []
        self.clips = []
        for clip, rec in zip(clips, recorded, strict=True):
            original, predicted = clip.get("frames"), rec.get("frames")
            if not isinstance(original, list) or not 4 <= len(original) <= 150 or not isinstance(predicted, list) or len(original) != len(predicted):
                raise ValueError("Wrong frame set")
            first = original[0]["timestampUs"]
            seen = set()
            row, assets = {"id": clip["id"], "frames": []}, []
            previous = -1
            for frame, inference in zip(original, predicted, strict=True):
                token, stamp = frame.get("token"), frame.get("timestampUs")
                if (not isinstance(token, str) or token in seen or type(stamp) is not int or stamp <= previous
                        or inference.get("token") != token or inference.get("timestampUs") != stamp):
                    raise ValueError("Receipt token/time does not match exact source frame")
                seen.add(token); previous = stamp
                at = (stamp-first)/1000
                if not number(inference.get("timeMs")) or abs(inference["timeMs"]-at) > .001:
                    raise ValueError("Receipt stream clock mismatch")
                name = frame.get("path")
                if not isinstance(name, str) or Path(name).is_absolute() or ".." in Path(name).parts:
                    raise ValueError("Unsafe image path")
                asset = (root/name).resolve(strict=True)
                if (not asset.is_relative_to(root) or not asset.is_file() or asset.suffix.lower() not in {".jpg", ".jpeg", ".png"}
                        or not 0 < asset.stat().st_size <= MAX_ASSET):
                    raise ValueError("Invalid source image")
                data = asset.read_bytes()
                if frame.get("sha256") != digest(data):
                    raise ValueError("Source image hash mismatch")
                with Image.open(BytesIO(data)) as image:
                    w,h = image.size
                    if not 32 <= min(w,h) <= max(w,h) <= 4096 or w*h > 12_000_000:
                        raise ValueError("Unbounded source geometry")
                    image.verify()
                # PNG verify must run directly after open; querying EXIF may
                # force Pillow to load first and invalidate that verification.
                with Image.open(BytesIO(data)) as image:
                    if image.getexif().get(274, 1) != 1:
                        raise ValueError("Review expects the same upright exposure as the receipt")
                iw, ih = inference.get("width"), inference.get("height")
                if (type(iw) is not int or type(ih) is not int or not 32 <= min(iw,ih) <= max(iw,ih) <= 768
                        or abs(iw/ih-w/h) > .005 or inference.get("nativeWidth") != w or inference.get("nativeHeight") != h):
                    raise ValueError("Receipt source/image geometry mismatch")
                timing = inference.get("timingsMs", {})
                if not isinstance(timing, dict) or any(not number(v) or v < 0 for v in timing.values()):
                    raise ValueError("Invalid replay timing")
                public = {"timeMs": at, "A": clean_lane(inference.get("A"), at), "B": clean_lane(inference.get("B"), at),
                          "timingsMs": timing}
                row["frames"].append(public)
                assets.append((asset, frame["sha256"]))
            self.assets.append(assets)
            self.clips.append(row)
        self.public = {"dataset": source["dataset"], "inputSha256": digest(raw), "clips": self.clips}
        self.cache = OrderedDict()
        self.lock = Lock()

    def thumbnail(self, clip, frame):
        if type(clip) is not int or type(frame) is not int or not 0 <= clip < len(self.assets) or not 0 <= frame < len(self.assets[clip]):
            raise KeyError("Unknown frame")
        key = (clip,frame)
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
            asset, expected = self.assets[clip][frame]
            raw = asset.read_bytes()
            if len(raw) > MAX_ASSET or digest(raw) != expected:
                raise ValueError("Source image changed since validation")
            with Image.open(BytesIO(raw)) as source:
                im = ImageOps.exif_transpose(source).convert("RGB")
                im.thumbnail((960,960), Image.Resampling.LANCZOS)
                output = BytesIO()
                im.save(output, format="JPEG", quality=88)
                data = output.getvalue()
            self.cache[key] = data
            while len(self.cache) > 2:
                self.cache.popitem(last=False)
            return data


HTML = r'''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RoboEye · Xem lại trên Mac</title>
<style>
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#fff}*{box-sizing:border-box}body{margin:0}header{display:flex;align-items:center;gap:20px;padding:20px 28px;border-bottom:1px solid #dedede}h1{font-size:23px;letter-spacing:-.7px;margin:0;font-weight:650}header p{margin:0;color:#686868;font-size:13px}header small{margin-left:auto;padding:7px 10px;border:1px solid #dedede;border-radius:6px;color:#686868;font-size:12px}main{padding:24px 28px 20px;max-width:1800px;margin:auto}.views{display:grid;grid-template-columns:1fr 1fr;gap:16px}.view{min-width:0}.view h2{font-weight:550;font-size:14px;margin:0 0 10px}.view h2 span{color:#686868;font-weight:400;margin-left:8px}.image{position:relative;background:#171717;min-height:200px;display:grid;place-items:center;overflow:hidden;border-radius:6px}.image.loading::after{content:'Đang tải khung…';position:absolute;bottom:10px;left:10px;background:#171717;color:#fff;padding:6px 9px;border-radius:4px;font-size:12px}canvas{display:block;width:100%;height:auto}.state{font-size:12px;color:#686868;min-height:27px;padding-top:8px}.state.warn{color:#935a00;font-weight:600}.controls{display:flex;align-items:center;gap:9px;border-top:1px solid #dedede;border-bottom:1px solid #dedede;padding:14px 0;margin-top:10px}button,select{font:inherit;font-size:13px;border:1px solid #c9c9c9;border-radius:6px;background:#fff;color:#171717;padding:9px 11px;min-height:40px}button:hover{background:#f0f0f0}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #426999;outline-offset:3px}#play{background:#171717;color:white;min-width:70px}#seek{min-width:60px;flex:1;accent-color:#171717}#clock{font-size:12px;color:#686868;white-space:nowrap;font-variant-numeric:tabular-nums}details{padding-top:16px;font-size:13px;color:#686868}summary{cursor:pointer;width:fit-content}pre{font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;color:#444}#error{color:#a72121;font-size:14px;min-height:20px;margin:12px 0 0}.hint{font-size:12px;color:#686868;line-height:1.5;margin:12px 0}button:disabled{opacity:.4;cursor:default}
@media(max-width:850px){header{padding:16px;gap:8px;flex-wrap:wrap}header small{margin-left:0}header p{font-size:12px}main{padding:16px}.views{grid-template-columns:1fr;gap:14px}.controls{flex-wrap:wrap}select{width:100%}#seek{order:5;flex-basis:100%}.image{min-height:160px}h1{font-size:21px}.view h2{margin-bottom:7px}}
</style><header><h1>RoboEye Assist</h1><p>Xem lại trên Mac</p><small>Clip đã ghi · Không dẫn đường</small></header>
<main><section class="views" aria-label="So sánh trên cùng khung hình"><div class="view"><h2>A <span>Bản gốc</span></h2><div class="image"><canvas id="a" width="960" height="803" aria-label="Khung hình A, hộp bản gốc"></canvas></div><div class="state" id="sa"></div></div><div class="view"><h2>B <span>Nhận diện lại ROI</span></h2><div class="image"><canvas id="b" width="960" height="803" aria-label="Khung hình B, hộp nhận diện lại ROI"></canvas></div><div class="state" id="sb"></div></div></section>
<nav class="controls" aria-label="Điều khiển phát lại"><select id="clip" aria-label="Chọn clip"></select><button id="prev" aria-label="Khung trước">‹</button><button id="play" aria-label="Phát clip">Phát</button><button id="next" aria-label="Khung sau">›</button><input id="seek" type="range" min="0" max="0" value="0" step="1" aria-label="Chọn khung hình"><output id="clock">0 / 0</output></nav>
<p class="hint">Màu phân biệt lớp vật thể. Chỉ ghi “tiến gần tương đối” khi nhánh thử nghiệm phát bằng chứng; không có số mét.</p><details><summary>Chi tiết khung hình</summary><pre id="diag"></pre></details><p role="status" id="error"></p></main>
<script>
'use strict';
const el=id=>document.getElementById(id), colors={person:'#a677ef',car:'#61c2ed',truck:'#e8b56c',bus:'#f1c567',motorcycle:'#76cba5',bicycle:'#c8d67a',train:'#d6a2bd'}, names={person:'Người',car:'Ô tô',truck:'Xe tải',bus:'Xe buýt',motorcycle:'Xe máy',bicycle:'Xe đạp',train:'Tàu', 'traffic light':'Đèn giao thông'};
let data,clip=0,index=0,playing=false,timer,request,serial=0;
for(const id of ['play','prev','next','clip','seek'])el(id).disabled=true;
function pause(){playing=false;clearTimeout(timer);el('play').textContent='Phát';el('play').setAttribute('aria-label','Phát clip')}
function pane(id,lane,img){const c=el(id),g=c.getContext('2d');c.width=img.width;c.height=img.height;g.drawImage(img,0,0);const approaching=new Set(lane.events.map(e=>e.trackId));g.lineWidth=Math.max(1.5,img.width/500);g.font=`600 ${Math.max(13,img.width/64)}px -apple-system,BlinkMacSystemFont,sans-serif`;for(const t of lane.tracks){const b=t.box,x=b.x*c.width,y=b.y*c.height,w=b.width*c.width,h=b.height*c.height,color=approaching.has(t.id)?'#f5ac38':colors[t.label]??'#e1e1e1';g.strokeStyle=color;g.strokeRect(x,y,w,h);const txt=`${names[t.label]??t.label} #${t.id}`,tw=g.measureText(txt).width,pad=5,bh=21,ty=Math.max(0,y-bh),tx=Math.min(Math.max(0,x),Math.max(0,c.width-tw-pad*2));g.fillStyle='rgba(17,17,17,.91)';g.fillRect(tx,ty,tw+pad*2,bh);g.fillStyle=color;g.fillText(txt,tx+pad,ty+15)}const label=el('s'+id);label.textContent=lane.events.length?'Thử nghiệm: tiến gần tương đối':lane.status==='valid'?'Chưa có báo tiến gần':'Chưa đủ bằng chứng';label.classList.toggle('warn',lane.events.length>0)}
async function render(){const token=++serial;request?.abort();request=new AbortController();const current=data.clips[clip],frame=current.frames[index];el('seek').max=current.frames.length-1;el('seek').value=index;el('prev').disabled=index===0;el('next').disabled=index===current.frames.length-1;el('error').textContent='';for(const id of ['a','b']){el(id).parentElement.classList.add('loading');el(id).setAttribute('aria-busy','true');el('s'+id).textContent='Đang tải khung đã chọn';el('s'+id).classList.remove('warn')}let img;try{const response=await fetch(`/frame/${clip}/${index}.jpg`,{signal:request.signal});if(!response.ok)throw Error('Ảnh nguồn không còn hợp lệ; dừng phát và kiểm tra receipt.');img=await createImageBitmap(await response.blob());if(token!==serial)return;pane('a',frame.A,img);pane('b',frame.B,img);el('clock').textContent=`${index+1} / ${current.frames.length} · ${(frame.timeMs/1000).toFixed(2)} s`;el('diag').textContent=JSON.stringify({frame:index+1,timeMs:frame.timeMs,A:{status:frame.A.status,reasons:frame.A.reasons},B:{status:frame.B.status,reasons:frame.B.reasons},timingsMs:frame.timingsMs},null,2)}catch(error){if(token===serial&&error.name!=='AbortError'){pause();el('error').textContent=error.message;for(const id of ['a','b']){const c=el(id);c.getContext('2d').clearRect(0,0,c.width,c.height)} }}finally{img?.close();if(token===serial)for(const id of ['a','b']){el(id).parentElement.classList.remove('loading');el(id).setAttribute('aria-busy','false')}}if(token===serial&&playing){if(index>=current.frames.length-1)pause();else timer=setTimeout(()=>{index++;render()},200)}}
el('play').onclick=()=>{if(playing){pause();return}playing=true;el('play').textContent='Dừng';el('play').setAttribute('aria-label','Dừng phát clip');if(index>=data.clips[clip].frames.length-1)index=0;render()};el('prev').onclick=()=>{pause();index=Math.max(0,index-1);render()};el('next').onclick=()=>{pause();index=Math.min(data.clips[clip].frames.length-1,index+1);render()};el('seek').oninput=()=>{pause();index=Number(el('seek').value);render()};el('clip').onchange=()=>{pause();clip=Number(el('clip').value);index=0;render()};document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});
fetch('/api/data').then(r=>{if(!r.ok)throw Error('Không đọc được dữ liệu kiểm tra.');return r.json()}).then(value=>{data=value;for(const [i,c]of data.clips.entries()){const option=document.createElement('option');option.value=i;option.textContent=c.id;el('clip').append(option)}for(const id of ['play','clip','seek'])el(id).disabled=false;render()}).catch(error=>{el('error').textContent=error.message;for(const id of ['play','prev','next','clip','seek'])el(id).disabled=true});
</script></html>'''


def create_server(data, port=4198):
    class LoopbackServer(HTTPServer):
        # One decoder at a time, no per-request thread pool/backlog. Seeking
        # aborts the browser request; at most two TCP requests may wait here.
        request_queue_size = 2

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(5)
            super().setup()

        def log_message(self, fmt, *args):
            pass

        def send(self, status, body=b"", content_type="text/plain; charset=utf-8"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            origins = {"http://"+h for h in hosts}
            if (self.headers.get("Host") not in hosts or self.headers.get("Origin") not in origins | {None}
                    or self.headers.get("Sec-Fetch-Site") == "cross-site"):
                self.send(403, b"Loopback origin only")
                return
            if self.path == "/":
                self.send(200, HTML.encode(), "text/html; charset=utf-8")
            elif self.path == "/api/data":
                self.send(200, json.dumps(data.public, allow_nan=False).encode(), "application/json; charset=utf-8")
            elif match := FRAME_ROUTE.fullmatch(self.path):
                try:
                    self.send(200, data.thumbnail(*map(int, match.groups())), "image/jpeg")
                except KeyError:
                    self.send(404, b"Unknown frame")
                except (ValueError, OSError):
                    self.send(409, b"Source verification failed")
            else:
                self.send(404, b"Unknown route")

        def do_POST(self):
            self.send(405, b"Read-only viewer")

        do_PUT = do_POST
        do_DELETE = do_POST
        do_PATCH = do_POST

    return LoopbackServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--port", default=4198, type=int)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Choose a loopback port between 1024 and 65535")
    data = ReviewData(args.input, args.receipt)
    with create_server(data, args.port) as server:
        print(f"Xem lại trên Mac: http://127.0.0.1:{args.port}/ (recorded replay; not live or phone acceptance)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
