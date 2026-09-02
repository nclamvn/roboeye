# Domain: realtime_hand_interaction

Registry chứng minh bốn quyết định kỹ thuật cho TIP-31: capture theo frame video,
MediaPipe trong worker với delegate, lọc 1€ và target acquisition có vùng bắt.

- `domain.yaml`: schema và universe 4 lớp nguyên nhân.
- `claims.jsonl`: claim có evidence span và provenance.
- `snapshots/`: bản chụp nguồn raw để kiểm toán không phụ thuộc trang sống.
- `RESULT.md`: digest, coverage và kết quả bites.

Từ thư mục gốc của skill refinery, chạy `refinery.py` rồi `bites.py` với đường
dẫn domain này để tái kiểm định.
