// Deliberately curated claims; exact raw spans checked before deterministic registry build.
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('./',import.meta.url),captures=JSON.parse(await readFile(new URL('captures.json',root),'utf8'));
const rows=[
['RT-DETRv2 R18 ONNX','availability','Detector hiện tại có các graph FP32, FP16 và quantized','rtdetrfiles','model_int8.onnx'],
['RT-DETRv2 R18 ONNX','weights_license','Model card ghi Apache-2.0','rtdetrcard','license: apache-2.0'],
['DA2 Metric Small','method','Metric depth ảnh đơn ngoài trời, học từ Virtual KITTI','da2','synthetic Hypersim / Virtual KITTI datasets'],
['DA2 Metric Small','weights_license','Apache-2.0 theo model card VKITTI Small','da2card','license: apache-2.0'],
['DA2 Metric Small','limitation','Cấu hình outdoor có max_depth 80; không phải bảo đảm chính xác tới 80 m','da2','80 for outdoor model'],
['MoGe-2 Small','method','Hình học ảnh đơn, point/depth/normal và camera FoV','moge','metric point maps, metric depth maps, normal maps and camera FOV'],
['MoGe-2 Small','contract','Graph ONNX chỉ forward; cần phục hồi hình học bên ngoài','mogeonnx','The ONNX model only includes the raw forward() pass'],
['MoGe-3','limitation','Nhánh upstream không hỗ trợ macOS do FlexGEMM/Triton; không phải thay thế browser drop-in','moge','macOS is not supported'],
['VDA Metric Small','method','Video metric depth, có nhánh streaming','vda','Support streaming mode for metric depth models.'],
['VDA Metric Small','limitation','Chế độ streaming được công bố là thử nghiệm','vda','Experimental features'],
['VDA Metric Small','weights_license','Apache-2.0 theo model card Metric Small chính chủ','vdacard','license: apache-2.0'],
['DA3 Metric Large','contract','Đổi output sang mét bằng focal*output/300, focal theo pixel đúng resize','da3','metric_depth = focal * net_output / 300.'],
['DA3 Chunk Streaming','method','Pipeline chia cụm frame, không đồng nhất với cập nhật causal một frame độ trễ thấp','da3stream','by chunking frames and managing state across chunks'],
['Metric3D Small ONNX','availability','Upstream liên kết graph ViT-Small với RAFT 4 vòng','metric3d','DINO2reg-ViT-Small  |    RAFT-4iter'],
['Metric3D Small ONNX','contract','Nhánh tham chiếu khôi phục thang camera từ focal đã resize /1000','metric3dhub','canonical_to_real_scale = intrinsic[0] / 1000.0'],
['Metric3D Small ONNX','code_license','BSD-2-Clause của upstream','m3license','BSD 2-Clause License'],
['Metric3D Small ONNX','weights_license','Metadata bản chuyển ONNX ghi CC0-1.0; cần kiểm nguồn checkpoint, không thay thế nghĩa vụ upstream','metric3dcard','license: cc0-1.0'],
['UniDepthV2','availability','Upstream có hỗ trợ ONNX','unidepth','ONNX support.'],
['UniDepthV2','code_license','CC BY-NC 4.0; không lựa chọn mặc định cho thương mại','unidepth','Creatives Common BY-NC 4.0 license'],
['GeoCalib','method','Ước lượng intrinsics và gravity từ ảnh đơn','geocalib','camera intrinsics and gravity direction'],
['GeoCalib','limitation','Principal point giả định giữa ảnh, không tối ưu','geocalib','The principal point is assumed to be at the center of the image and is not optimized.'],
['GVDepth','method','Kết hợp xác suất hai cue: kích thước và vị trí dọc ảnh','gvdepth','probabilistically fuses depths estimated via object size and vertical image position cues'],
['GVDepth','contract','Vị trí tiếp xúc mặt đường theo chiều dọc ảnh là cue phối cảnh độc lập cần đối chiếu với kích thước','gvpaper','vertical image position of the ground-contact point'],
['GVDepth','limitation','Bước calibration trong paper dùng depth đối chứng, không tự hiệu chuẩn metric từ video RGB trống','gvpaper','ground-truth depth maps'],
['MonoGround','method','Mặt đường bổ sung điều kiện hình học và một nguồn depth cho monocular 3D','monoground','ground plane prior serves as an additional geometric condition'],
['FUMET','method','Học metric scale cho monocular road-scene từ dashcam','fumet','learn metric scale only from dashcam videos'],
['FUMET','inputs','Quy trình huấn luyện công bố còn cần mask xe và chiều cao ước lượng','fumet','car masks and their estimated heights'],
['FlashDepth','method','Streaming video depth','flash','Streaming Video Depth Estimation'],
['FlashDepth','code_license','Apache-2.0 theo LICENSE của code','flashlicense','Apache License'],
['FlashDepth','limitation','Benchmark paper có alignment scale và shift theo cả chuỗi; không chứng minh mét thô','flashpaper','align the entire predicted sequence with ground truth'],
['MetricAnything PointMap','method','Student point map metric','metricanything','point map with metric scale'],
['MetricAnything PointMap','weights_license','Apache-2.0 theo model card student pointmap','macard','license: apache-2.0'],
['MetricAnything DepthMap','inputs','Ví dụ infer yêu cầu focal pixel; giá trị image.width chỉ là mặc định','metricanything','f_px = image.width  # or provide real focal length if available'],
['Depth Pro','method','Mô hình metric depth ảnh đơn','depthpro','zero-shot metric monocular depth estimation'],
['GARD','method','Hình học monocular từ góc camera ven đường','gard','roadside monocular cameras'],
['GARD','inputs','Cần intrinsics hiệu chuẩn và chiều cao lắp camera','gard','well-calibrated camera intrinsic parameters and the camera’s installation height'],
['ORT WebGPU','contract','Giữ tensor GPU bằng IO binding; chuyển CPU/GPU có chi phí','ort','IO binding'],
['ORT WebGPU','limitation','Graph capture cần kiểm điều kiện shape và kernel; không đảm bảo chạy cho mọi model','ortperf','Even with static shape input, this feature does not always work for all models.'],
['YOLO26 Depth','limitation','Validator có scale alignment; không suy chất lượng mét thô từ điểm đã align','yolodepth','uses median (scale-only) alignment']
];
const claims=[];
for(const [entity,field,value,id,evidence_span] of rows){
 const capture=captures.find(c=>c.id===id&&!c.error);if(!capture)throw Error('Missing capture '+id);
 const raw=await readFile(new URL('snapshots/'+capture.snapshot,root),'utf8');
 if(!raw.includes(evidence_span))throw Error(`SPAN_NOT_FOUND ${entity}: ${evidence_span}`);
 claims.push({entity,field,value,evidence_span,extraction:'normalized',tier:'A',capture:{url:capture.url,source:capture.source,snapshot:capture.snapshot,fetched_at:capture.fetched_at}});
}
await writeFile(new URL('claims.jsonl',root),claims.map(c=>JSON.stringify(c)).join('\n')+'\n');
console.log({claims:claims.length,entities:new Set(claims.map(c=>c.entity)).size});
