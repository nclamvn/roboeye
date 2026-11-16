# TIP-65 M2 · Đối chiếu hiểu cảnh trên Mac

Không chờ iPhone: thử thực trên ảnh công khai đã ghim của dự án. Cùng model
SmolVLM2 500M, cùng ảnh/câu hỏi tiếng Việt: A chỉ ảnh; B thêm lớp/vị trí do
YOLOv3 thật trên Mac cung cấp; C mô tả-tóm tắt bằng lõi SceneNarration hiện hữu
từ cùng quan sát YOLOv3. C trên ảnh tĩnh không có LiDAR hoặc lịch sử.
Đo câu trả lời, thời gian và ca từ chối. Scope: Mac Apple Silicon, con số
chỉ có giá trị ở môi trường này. Không tích hợp model vào iOS, không upload
ảnh, không API trả phí, không cài kính, không commit/push.

- G1: snapshot model cố định, venv/cache trong thư mục build ignored; không
  dùng remote code. Báo model/revision, dependency, ảnh SHA-256 và số lượt.
- G2: cùng hình/tọa độ xoay cho A/B/C; mốc chấm do một người đọc hình trước
  khi chạy model. Unknown được chấm riêng, không bắt model đo metres từ RGB.
- G3: model chạy local thực, giữ lời đáp nguyên văn và thời gian từng lượt
  kể cả sai/hết token; trình bày phân tích mẫu nhỏ, không xếp hạng sản phẩm.
- G4: không có quyền dùng mạng từ ảnh/QA; chỉ tải public weights/deps/
  fixture. Một model, không chạy lâu quá cần thiết, không tự nâng scope.

V1 làm ảnh tĩnh và hướng; không dùng ảnh để chấm biến đổi theo thời gian.
Tiếp sau: corpus Việt có đồng ý và chuỗi khung, rồi mới xét iPhone/VLM khác.

## Kết quả · 14/11/2026

**Đã chạy thật trên Mac; SmolVLM2 không đạt cổng tiếng Việt ở cấu hình này.**
Giữ M1 làm mốc. Không nối lời tự do của VLM vào sản phẩm. Mac Apple M1 Max
32 GiB, macOS 27.2; YOLOv3 FP16 qua Vision/Core ML, SmolVLM2 500M qua MLX,
mô hình local, 96 token tối đa, temperature 0. Cùng hai JPEG công khai cho
bốn câu nhìn ảnh và hai câu cố ý thiếu bằng chứng. Hai ảnh đã dùng làm
smoke test trước đó, không phải tập giữ kín. Mốc chấm soạn trước lần chạy
VLM, do trợ lý tự đọc ảnh, không phải nhãn độc lập.

| Phương án | Câu nhìn ảnh hữu ích | Từ chối phù hợp khi thiếu dữ liệu | Trung vị tới chữ đầu / hết lượt |
|---|---:|---:|---:|
| A · Ảnh, hỏi trực tiếp | 0/4 | 1/2 | 2,46 s / 6,07 s |
| B · Cùng ảnh, thêm thông tin YOLO | 0/4 | 0/2 | 2,53 s / 6,46 s |
| C · YOLO + câu theo mẫu M1 | 4/4 ở mức lớp/hướng | 2 câu không có trong đối chứng tĩnh | Không đo đầu-cuối |

“Hữu ích” là có câu trả lời trực tiếp với ít nhất một quan sát liên quan,
không phải đủ mọi chi tiết. C nhận đúng nhóm người/chim và trả lời hướng
thận trọng, nhưng không mô tả được màu áo hoặc hoạt động, hai số người là
số phát hiện của model chứ không phải số đếm đối chứng. C cũng gán nhãn
“vali” trong cảnh có xe đẩy; chưa đủ căn cứ kết luận đó là cùng một vật.
A và B chủ yếu lặp câu hỏi/hướng dẫn, lần lượt 2/6 và 4/6 lượt chạm trần
token, 0/12 lỗi thực thi. A từ chối số mét nhưng không trả lời được câu
về chuyển động. Không coi lặp hướng dẫn là từ chối đúng.

Kiểm tra chẩn đoán sau phép thử, không tính vào bảng: cùng snapshot và hai
ảnh, hỏi ngắn tiếng Anh “What is in this image? Answer with a short phrase.”
(tối đa 32 token). Model trả lời “seagull.” và “man pushing a stroller”.
Điều này xác nhận đầu vào ảnh có tác dụng trong cấu hình MLX; không tách
được ảnh hưởng của ngôn ngữ khỏi độ dài/hình thức câu hỏi, và không xác
nhận hành động xảy ra từ một ảnh tĩnh.

Thời gian A/B bắt đầu trước lúc áp chat template, không gồm tải model,
YOLO, camera hay giọng đọc. YOLO mất 50,6–84,6 ms riêng cho hai lần Vision
nhận diện, không quy thành FPS. Ở B, box được lấy từ lần chạy detector
trước đó và tái dùng. Không có bằng chứng rằng thêm box cải thiện câu
trả lời; cũng không đủ mẫu để kết luận về mọi VLM hoặc mọi cách nhắc lệnh.

Bằng chứng: [JSON nguyên văn, 18 dòng kết quả A/B/C](evidence/tip65/m2-mac-pilot.json).
Swift regression: **117/117**; model/ảnh đúng SHA-256; smoke EXIF 6 đã kiểm
trên Core ML thật. Không có số đo pin, nhiệt, độ trễ âm thanh,
chuyển động hay iPhone. Chưa kiểm độ an toàn khi di chuyển.

## Chạy lại trên Mac

Tại thư mục gốc repo. Kiểm tra đĩa trống tối thiểu 10 GB trước khi chuẩn
bị môi trường mới. Nếu venv/model đã có, bỏ qua bước tải và không tải
lại lần nữa. Tệp model nằm trong cache build không đưa vào Git.

```sh
qa_dir="$PWD/native/ios/.build-xcode/scene-qa"
mkdir -p "$qa_dir"
export UV_CACHE_DIR="$qa_dir/uv-cache"
export UV_PYTHON_INSTALL_DIR="$qa_dir/python"
export UV_LINK_MODE=copy
uv venv --python 3.12 "$qa_dir/venv"
uv pip install --python "$qa_dir/venv/bin/python" \
  mlx-vlm==0.7.12 mlx==0.32.4 transformers==5.23.0 Pillow==13.0.0
HF_HUB_DISABLE_XET=1 "$qa_dir/venv/bin/hf" download \
  mlx-community/SmolVLM2-500M-Video-Instruct-mlx \
  --revision fa57db46815177fbdfd65cc85a2b3416a8332268 \
  --local-dir "$qa_dir/smolvlm2-fa57db4"
node scripts/download-assistive-object-model.mjs --fixtures
```

Phần sau không tải thêm gì. Chạy từ Terminal Mac được phép sử dụng
Vision; sandbox của agent hiện tại có thể chặn Vision/Core ML.

```sh
qa_dir="$PWD/native/ios/.build-xcode/scene-qa"
node scripts/download-assistive-object-model.mjs --verify-only --fixtures
detector_dir="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
if [ ! -d "$detector_dir" ]; then
  detector_dir="$qa_dir/YOLOv3FP16.mlmodelc"
  xcrun coremlcompiler compile native/ios/Models/YOLOv3FP16.mlmodel "$qa_dir"
fi
xcrun --sdk macosx swiftc -O -module-cache-path "$qa_dir/ModuleCache" \
  native/ios/Core/*.swift native/ios/SceneQA/main.swift -o "$qa_dir/sceneqa"
PYTHONDONTWRITEBYTECODE=1 /usr/bin/perl -e 'alarm shift; exec @ARGV' 210 \
  "$qa_dir/venv/bin/python" scripts/assist-scene-mac.py \
  --vlm "$qa_dir/smolvlm2-fa57db4" --detector-cli "$qa_dir/sceneqa" \
  --compiled-detector "$detector_dir" \
  --fixture-dir native/ios/.build-xcode/model-qa > "$qa_dir/pilot-receipt.json"
```

Ở lượt ghi JSON, dùng artifact Core ML đã có từ build M1, cùng nguồn trọng
số. Trình chạy bật offline và chặn kết nối Python, không luồng ảnh hay
camera cá nhân. Nguồn: [model upstream](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct),
[snapshot MLX](https://huggingface.co/mlx-community/SmolVLM2-500M-Video-Instruct-mlx/tree/fa57db46815177fbdfd65cc85a2b3416a8332268),
[MLX VLM](https://github.com/Neywa-Labs/mlx-vlm).

**Cổng tiếp theo không cần iPhone:** lập một tập nhỏ cảnh Việt có nhãn
độc lập, kèm chuỗi khung và các ca thiếu bằng chứng; chạy cùng giao thức
với ứng viên VLM đa ngôn ngữ, kiểm giấy phép và mức dùng RAM trước khi tải.
Tiếp tục dùng C cho lớp/hướng cho đến khi phương án sinh văn bản thêm được
chi tiết đúng mà không bịa khoảng cách, chuyển động hay chỉ đường.

Vệ sinh đĩa: đã dọn cache tải thư viện riêng của M2 (825,9 MiB) và bản
Core ML biên dịch trùng tạo khi kiểm tra lệnh chạy lại (119 MiB). Giữ
snapshot và venv tái chạy trong cache build đã ignore (khoảng 1,9 GiB
gồm công cụ biên dịch);
không tạo bản sao dự án hay thư mục scratch tồn lưu ngoài repo.
