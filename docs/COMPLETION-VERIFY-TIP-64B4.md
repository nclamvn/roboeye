# COMPLETION + VERIFY — TIP-64B4

2026-10-11 · Contractor: vibecode-kit v6.2 · UI: frontend-design.

## Outcome / status

**Follow-up 2026-10-11,14:21 Việt Nam:** người dùng yêu cầu cài lại. Cùng bản0.2.2/build5 đã được cài lại, default launch và liveness5giây xác minh thành công. [Biên bản cài lại](COMPLETION-VERIFY-TIP-64B4-R.md). Lỗi khóa mô tả ở lần cài ban đầu bên dưới được giữ làm lịch sử; không còn là trạng thái khởi chạy mới nhất. Chưa kiểm camera/semantic accuracy.

**DONE for the bounded B4 software repair; INSTALLED on iPhone; PARTIAL for the wider recognition product.** RoboEye Assist **0.2.2 / build 5** is read back from the physical iPhone after installation, not inferred from build success. Default launch was denied because the device was locked; no unlock bypass, automatic camera or recording was attempted. User has been asked to unlock or open the app themselves. That launch restriction is not a demonstrated app crash.

Badges now have actual opaque chromatic fills by canonical object class. Phone is violet, remote ochre, person azure, chair teal, book indigo, bottle berry and refrigerator petrol. IDs/names remain: thirteen family tokens do not uniquely encode all eighty classes. Minimum white contrast is **5.645:1**. Unknown metres retain the class fill and explicitly say `— m · chưa đo`; status is separate.

An approved bounded tracker repair removes obsolete contradictory phone/remote coast boxes and high-overlap competing hypotheses at IoU > 0.75. Stronger raw score wins; label ties are deterministic. New identity gets no borrowed metres. This **does not prove the model chooses the correct class**. **Fan recognition is still absent** from the shipping vocabulary.

Vibecode separated Contractor evidence/acceptance from Builder application changes. Frontend-design influenced class-owned chromatic emphasis, restrained camera controls, white contrast and separate measurement status. Neither methodology was used to claim semantic accuracy from UI polish.

## Requirements coverage

| REQ | Implemented / verified |
|---|---|
| C01 | Seven distinct common-class actual fills, canonical aliases and class/ID independence; pure tests plus real rendered-pixel assertions and Contractor image review. PASS |
| C02 | All thirteen tokens >=4.5:1; opaque measured/unknown/Reduce Transparency fills; range text remains explicit. PASS |
| C03 | Retained planes/AX/collision/raw coordinates/TTL preserved; eighteen UI regressions and seven actual screenshots reviewed. PASS, dense/accessibility trade-offs below |
| C04 | Actual artifact vocabulary and code/preprocessing/score investigation, primary-source candidate/license comparison; semantic error not falsely called fixed. PASS for investigation, not detector recall |
| C05 | Version 0.2.2/build5, B4-only gate, immutable B1–B3, signed-bundle verification and physical installed readback. PASS; default-launch liveness remains unverified while locked |
| C06 | Both relabel directions, strongest competing score, deterministic tie, separated/sub-boundary objects and unrelated nesting; no range transfer. PASS |

Total B4 scoped requirements **6**; implemented **6**; missing **0**; deferred scoped **0**; coverage **100% of this repair contract**, not 100% of the requested all-object assistive product. Fan, semantic phone disambiguation and physical safety/performance gates remain open.

## Frozen-source QA

Canonical invocation: `npm run qa:assistive-objects -- --local-photo <existing user refrigerator JPEG>`, on the reused simulator and caches. Private input pixels were not copied or uploaded. [Full receipt](evidence/tip64b4/runs/2026-10-11T06-48-33-449Z/summary.json).

| Gate | Exact result |
|---|---|
| Swift XCTest | **106/106**, zero failures: 25 Core +47 Tracking +24 Presentation +10 RuntimePolicy |
| Native↔TypeScript contract | **7/7 PASS**; no web bundle/UI rerun |
| Simulator UI XCTest | **18/18 PASS**, zero failures / skipped / expected failures; runtimeWarnings empty |
| New UI pixel checks | **2/2 PASS**, actual seven-class padded badge interiors in sRGB, alpha255; measured bright and unknown+Reduce Transparency |
| Portable palette | 13 tokens; seven common fills distinct; minimum contrast5.645401743:1 |
| Simulator restoration policy | **9/9** pure regressions; exact reused device independently back at initial Shutdown state |
| Real local-model smoke | **3/3** bird/person/refrigerator, shipping combined-confidence0.38 and IoU0.45; **not semantic recall benchmarks** |
| Unsigned Release / Swift platform compile | PASS; **0 build/type errors** |
| Static analysis | PASS, exit0; no analyzer defect reported |
| Signing generator protection | PASS: refused overwrite; existing project checksum unchanged |
| Signed Release / codesign | PASS, existing Team/bundle, strict signature verification; offline model nonempty and license identical |
| Physical installation/readback | PASS: 0.2.1/build4 → **0.2.2/build5**; default launch separately failed with device Locked |

No separate lint metric is claimed: Builder Node syntax checks, Swift parse, Info/PBX plist lint passed; main platform build/static analysis are the authoritative compile gates. Before the final frozen gate, Core Builder found an equal-score same-class ordering regression in its first portable run, corrected it, then passed106/106. No final assertion was waived.

Source before/after full QA, after signed build and after installation:
`37b61c9614bf015e194eabca2bfff3ef6dbae104e78c7e261b8238f15801fb14`.
B1/B2/B3 combined evidence before/after:
`6c5205c5c6f5ed55db68ed2967590a860a720f7891fa49a7095e33a5701afb32`.
Model remains `276afae53da362e25ad21c827f8a929a8512254b1343433d970e725a0de57d8f`.
These are software/artifact provenance, not physical measurement certification.

## Contractor visual review — actual B4 attachments

All filenames below are in `evidence/tip64b4/runs/2026-10-11T06-48-33-449Z/screenshots/`, mapped by its actual manifest.

| Attachment | Critique / acceptance |
|---|---|
| `C8F46C3B-880C-4332-8F6E-D78112E636AA.png` · seven classes bright measured | All seven names/metres visibly chromatic and legible; no black-fill substitution; phone/remote distinct. PASS |
| `6C09F038-FDAB-4EFF-97FD-52391341AE68.png` · seven classes unknown/transparency | Same hues, explicit unknown metres, opaque panels and readable separate amber status. PASS |
| `00DD2EE5-E9EE-4988-B175-E6EBE5C6D0A7.png` · dense twelve IDs | Visible plates readable, geometry under plates, no plate overlap. Some crowded labels omitted by policy while all twelve AX identities are retained. PASS within policy |
| `C2B87765-66F7-4698-89BC-B62B2B75283A.png` · accessible portrait | Large names wrap / reflow without geometry crossing text; controls readable. More labels omitted to avoid collision. PASS within policy |
| `8E33B714-8202-4E70-9415-FF1D44B39768.png` · accessible landscape | Instruments remain readable/reachable, but at this very large font/short viewport no object badge fits; outlines/AX/focus remain. Accepted existing bounded accessibility fallback, **not ideal simultaneous scene visibility** |
| `5D0B33E4-AAA9-4829-A165-4C148E31801F.png` · bright edge landscape | Edge outlines remain, unsafe plate placement over HUD rejected; controls/readout clear. PASS |
| `BD6D3297-11C6-464F-8D6A-895355433BBD.png` · compact bright portrait | Strong class fills and readable compact controls on bright scene. PASS |

These are permanently watermarked simulated UI fixtures, not evidence that real phones/fans were detected. The overall semantic recall, live FPS and physical range cannot be inferred from these images.

## Scenario ledger

Distinct acceptance scenarios, not a second summed test count: **11 passed /1 failed capability /4 untested**.

Passed: (1) seven-class bright fills; (2) aliases/unknown/opacity; (3) dense IDs/layout; (4) Dynamic Type/AX reachability; (5) edge/rotation; (6) jitter/Reduce Motion/strict stale metres; (7) stop/background/manual/explicit recording; (8) pair-conflict tracking and negative cases; (9) real-model execution smoke; (10) JSON interop; (11) signed installation and version readback.

Failed capability, **not an XCTest failure**: (12) fan recognition is unavailable by confirmed model vocabulary.

Untested: (13) default-launch liveness blocked by locked device; (14) physical phone↔remote semantic accuracy; (15) physical surface-range error/coverage; (16) live camera-to-screen pacing/latency and30-minute thermal endurance. No physical camera was started by the agent.

## Files / deviations / hygiene

- UI Builder: `Core/ObjectPresentation.swift`, `Tests/ObjectPresentationTests.swift`, `App/ObjectOverlay.swift`, Debug-only fixtures in `App/ProbeViewController.swift`, `UITests/ProbeUITests.swift`; version in Info/PBX/generator; current QA/preflight/interop/alias namespace and new portable palette checker. [Builder report](BUILDER-TIP-64B4-UI-QA.md).
- Core Builder: `Core/ObjectTracking.swift`, `Tests/ObjectTrackingTests.swift`, [recognition scan](RECOGNITION-SCAN-TIP-64B4.md).
- Contractor: TIP, native/root README documentation, [model decision](MODEL-DECISION-TIP-64B4.md), this report and [sanitized install receipt](evidence/tip64b4/phone-install-2026-10-11.json).
- C06 was a documented compatible scope addition after finding the duplicate root cause. No architecture/dependency/model/threshold/preprocessing/range-contract change. ModelQA EXIF handling was **not silently changed**.
- Disk53GiB before and after; reused `.build`/`.build-xcode` and existing simulator. No scratch project copies, venvs/dependencies or extra build folders created; nothing material deleted. No commit/push/web deploy. Existing unrelated/user changes preserved.

## Next gate / decisions

**READY**: test installed B4 class colors and bounded tracker repair. Open app → **Tự động → Mở camera**; restart after background manually. Unknown metres stay honest.

**P1 NOT READY**: all-object commercial assistive/navigation claim, fan recognition, semantic phone improvement. Run a local phone/remote/fan comparison with licensed, disjoint development/holdout data before promoting one model. [Candidate/license/benchmark plan](MODEL-DECISION-TIP-64B4.md). MobileCLIP code/weight licenses differ; do not assume commercial rights from code MIT.

**P2**: fix image-QA EXIF and collect top-k alternatives before preprocessing experiments; refine very-large-font landscape scene space if that use case is prioritized. Physical range calibration, device thermal/latency, Android and speech/haptics remain separate gates. No use for independent navigation or driving decisions.
