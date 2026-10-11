# TIP-64B1-H — Native install / demo hardening

2026-10-10 · Vibecode v6.2 · P0 · depends on TIP-64B1/64A.

## Contractor scan / decisions

The requested audit covers the approved native point-depth probe and regression of the existing browser product. UIKit/ARKit, portable Swift core, closed TypeScript evidence contract; no database/auth/paid API/native dependencies. Native recording is bounded and memory-only. The existing software receipts do **not** validate physical iPhone performance or accuracy. No physical phone is connected; no signing Team configured. Full semantic recognition, automatic tracking, speech and navigation are still missing from the larger virtual-eye vision, not silently considered complete.

Confirmed code risks: export/canonicalisation on the main thread; per-frame redundant UI mutations; recording deadline depends on delivered AR frames; pending camera permission has no explicit start/cancel state; truth alert binds to whichever recording is last at submission rather than the one shown; stale modal/export lifecycle; machine-specific simulator UUID; QA subprocesses have no deadline. Checkpoint shortened because the user explicitly authorises fixes/upgrades inside the approved architecture. No model/provider/contract change or commercial release approval inferred. Sequential roles Contractor → Builder → Contractor, no subagents; Jev OFF.

## Blueprint / constraints

Keep one ARSession; process only 25 sparse samples at ≤15 Hz; no retained image/depth history, no unbounded work queue. Coalesce valid UI presentation to 10 Hz, invalidate unsupported/stale values immediately; never smooth or retain invalid metres to improve appearances. Independent common-mode heartbeat enforces record deadlines. Explicit starting state/cancellation. Export one immutable bounded snapshot on a utility queue, cancel publication/file creation when the session is revoked. A worker snapshot may remain transiently until that bounded export finishes; document this honestly. Exact recording/frame/target binding for truth. Do not erase user recordings outside app memory or any simulator/device. Keep signed-device installation separate from unsigned build.

## Requirements / AC

| REQ | Given / when / then | Verification |
|---|---|---|
| H1 | Continuous frames: UI mutations are coalesced, sparse sampling bounded; missing/stale data clears metres | UI + core + review |
| H2 | Recording receives no more frames: independent heartbeat stops at time cap; malformed clock cannot hang cap | Core + adapter review |
| H3 | Permission/start pending then cancel/leave app: late callback cannot restart; idle timer restored after stop | Lifecycle UI + review; permission hardware pending |
| H4 | Truth form opened then recording revoked/replaced: old binding is refused and modal dismissed | Core + UI |
| H5 | Export repeated/revoked/background: one job only; main UI remains responsive; stale job cannot share or write files | Core + simulator export seam |
| H6 | Invalid support/geometry: no unsupported metres, strict native/web interoperability remains intact | Core + cross-language |
| H7 | QA on installed tools: simulator discovered, child deadlines + scratch cleanup; unsigned Release/analyzer + browser regression pass | QA receipts |
| H8 | Installer/demo handoff: factual prerequisites, explicit missing features and device rehearsal checklist; no signed-install claim | Read-only preflight + guide |

Physical device capture/accuracy/latency/thermal/crash acceptance is **NOT TESTED** until a trusted iPhone and signing Team are available. Completion must be labelled software-ready vs investor-demo-ready. No guarantee of zero latency/crashes on untested hardware. No commit/push/deploy in this task.
