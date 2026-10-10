# TIP-63 — Completion / Verify

2026-10-10, Vibecode v6.2; sequential Contractor → Builder → Contractor. The
approved task is implementation plus existing-branch commit/push and existing
Vercel production deployment after QA. No purchase, owner-video upload, AGPL
model promotion or new production endpoint.

## Implemented / requirement coverage

- R1: SHA/byte-pinned official Apache YOLOX-Nano, shipped licence/notice,
  BGR/top-left/raw-grid decoder, class-winner/global NMS and isolated ORT1.30.
  Continuous-coordinate NMS / Canvas resize adaptations are explicitly
  disclosed, not asserted to be byte-identical to upstream OpenCV.
- R2: auto mobile/Nano/RT-DETR selection; measured ten-sample detector and joined
  budgets, CPU-only light route, one automatic depth probe and bounded owned
  recovery. Baseline and explicit AI test remain selectable.
- R3–R5: ≥6 measured fit / ≥2 independent checks, inverse-road-plane fit,
  rank/span/roll/domain/sensitivity guards, source/zoom invalidation, same-capture
  metre estimates, local freeze/pick, keyboard/pointer, import re-fit/export and
  fixed-camera/flat-road confirmation. No guessed phone FOV or fake values.
- R6: bounded per-target metre/box time, blackout and fresh-observation export,
  reset scope and explicit truncation. Independent accuracy/eligible coverage
  remain null and product verdict `not-validated` without physical labels.
- R7: **14/14 partner software gates PASS**, frozen runtime source unchanged;
  **331/331 unit tests PASS**, zero skipped. Actual Nano WASM/WebGPU, calibration
  UI with metre publication/export/zoom rejection/no depth dispatch, and
  compiled Nano + 375/430/1440-width layouts also PASS. Zero JS errors/external
  model requests in Nano tests. Existing portrait gate rechecked in task TMPDIR.
- R8: release handoff/HTTPS receipt is maintained outside this checkout at
  `release-tip63/COMPLETION-VERIFY.md` beside the project. It will contain the
  actual commit, non-force push, deployed identity and post-deploy checks,
  avoiding a self-referential commit merely to record its own SHA.

Coverage: R1–R7 software acceptance 7/7; R8 completes only with the external
receipt. **Software acceptance ≠ physical-phone or commercial-road acceptance.**

## QA evidence / failures retained

`release-tip63/qa/partner/summary.json` records the full 14-stage rerun. A first
attempt hit a Vite worker-dependency fixture reload before inference; the
harness now retries only that explicit no-run state, at most twice, within the
same deadline and still requires actual inference. A subsequent gate exposed
a dual-GPU-crash recovery ownership race. The owned backoff is now respected,
and the six live plus three bounded-recovery scenarios pass. Earlier failed
attempt logs remain in the handoff directory; neither was counted as PASS.

Native graph inspection and public bus model tests prove shape/adapter/runtime
execution, **not highway recall or physical metre accuracy**. UI metre tests
use labelled synthetic ground truth and mock workers; they are not phone tests.
The source licence/runtime choices follow primary-source Refinery evidence.
The existing 10-candidate review and the shipping addendum preserve honest-null
phone accuracy, independent audits and injected gate-bite results.

Build, security and release contract PASS. Security: 0 critical / 0 high;
existing moderate dependency findings are not claimed eliminated. Lint NOT RUN
(no configured lint task). No physical iPhone/Xiaomi/old-phone soak, independent
road-distance benchmark, automatic dynamic road plane, pedestrian/cycle/moto
recall expansion, baseline runtime-major migration or certification is claimed.

## Test handoff

Open HTTPS on a parked phone; Camera → on-video **Đo theo mốc** for the light
route. Measured ≥6 fit + ≥2 separate check points are required, camera fixed,
flat road, same lens/crop/zoom. Numbers appear only for sufficiently supported
vehicles inside that calibrated domain. Import a profile only with the same
setup. Auto/GPU AI remains experimental and may abstain; details/report show
why. Do not operate the UI while driving or use this PoC to decide braking or
steering. A passenger may collect observations.

Frontend-design kept calibration inside the existing Analysis overlay and the
entry button in actual video coordinates, with no new HUD flashing or wall of
text. Disk hygiene: no project copies, reused dist/deps/venv, one task TMPDIR;
small Refinery copies self-clean. Existing unrelated legacy directories are
preserved. Persistent QA/receipts stay outside temporary storage.
