# FastWarm Local handover

## 2026-11-18 — dedicated provider extraction

Release candidate: `@jdipper/homebridge-fastwarm@0.1.0-jdipper.1`, extracted from Tuya fork `2.7.3-jdipper.13` (source checkpoint `a713765c7f88af10d2895f047ab3b42b3fa4b9a7`). Shared companion: Heating Programmes `0.1.0-jdipper.10`. Hive remains independently owned by its existing provider.

The source is a clean public snapshot with original MIT attribution. Normal runtime is local-only. Optional explicit SmartLife label import remains separate and lazy-loaded; local keys are entered separately through private setup. Generic Tuya accessories, MQTT networking and general override configuration are omitted.

Stable provider instance, local key/metadata files, legacy IPC namespace, logical room IDs and operation history are preserved. The descriptor truthfully advertises the dedicated package. Shared validates the exact old/new identity and invalidates pending write previews across an ownership change. Grouped Home/Holiday controls, saved profiles, transition safeguards and API optimisations remain in Shared.

Private deployment helpers stage immutable checked archives, back up configuration/caches/pairings/private state, stop the two migrating children, project the one platform, reassign cached ownership and require one main Homebridge restart. Migration and verification are read-only with respect to heating settings. No public repository contains installation-specific data or live recovery files.

## Validation scope

Offline suites cover native session/schedule behaviour, no-cloud startup, owner exclusion before connection or metadata writes, strict configuration, cache identity, private files, optional import boundaries and UI setup. Live migration results must be appended only after they are verified. Existing pre-extraction LAN evidence does not constitute a new multi-room schedule-write test.

Remaining separate validation: broad multi-period local schedule-write coverage and a deliberate internet-loss test. Do not claim either was completed by package extraction. Never start a raw competing LAN client while a production provider owns a device.
