# FastWarm Local handover

## 2026-11-18 — dedicated provider extraction

Installed release: `@jdipper/homebridge-fastwarm@0.1.0-jdipper.1`, extracted from Tuya fork `2.7.3-jdipper.13` (source checkpoint `a713765c7f88af10d2895f047ab3b42b3fa4b9a7`). Shared companion: Heating Programmes `0.1.0-jdipper.10`. Hive remains independently owned by its existing `.4` provider.

The source is a clean public snapshot with original MIT attribution. Normal runtime is local-only. Optional explicit SmartLife label import remains separate and lazy-loaded; local keys are entered separately through private setup. Generic Tuya accessories, MQTT networking and general override configuration are omitted.

Stable provider instance, local key/metadata files, legacy IPC namespace, logical room IDs and operation history are preserved. The descriptor truthfully advertises the dedicated package. Shared validates the exact old/new identity and invalidates pending write previews across an ownership change. Grouped Home/Holiday controls, saved profiles, transition safeguards and API optimisations remain in Shared.

Private deployment helpers stage immutable checked archives, back up configuration/caches/pairings/private state, stop the two migrating children, project the one platform, reassign cached ownership and require one main Homebridge restart. Migration and verification are read-only with respect to heating settings. No public repository contains installation-specific data or live recovery files.

## Validation scope

Offline suites cover native session/schedule behaviour, no-cloud startup, owner exclusion before connection or metadata writes, strict configuration, cache identity, private files, optional import boundaries and UI setup. All 538 plugin tests, 301 Shared tests and 85 private migration/verifier tests passed. [Linux CI for source `9ffc3c3`](https://github.com/jdipper/homebridge-fastwarm/actions/runs/44306032533) passed without a rerun. Existing pre-extraction LAN evidence does not constitute a new multi-room schedule-write test.

## Installed migration and read-only proof

The checked archive was built from production source `564ad214594410df45d30cc6697791319d735fa0`; subsequent `9ffc3c3b1b285af34be6699d1e136aea4c150320` changes only portable test fixtures. The Shared compatibility source is `5cb96f0dd95ccbb219b9f8f1834238f9bc49baea` on `feat/fastwarm-local-provider`. Later documentation commits do not replace the immutable installed archives.

- FastWarm archive SHA256: `b2adebbec6434fee0ef736a69dfba47b2504d5cdcf0bd1026bfed95f3873e92a`.
- Shared archive SHA256: `d529847f9bc90b3da58e6347eb868659ab4be33dd635d357230cdea1dc7bce1b`.
- Manifest SHA256: `67b6b48f4d620ace26314932236d0db3e9e0776689cf796025271ff38e8c5af1`.

The migration backed up private settings, cached accessories and HAP persistence; copied the exact existing two dependency packages without install scripts; replaced the one active provider; and restarted the main bridge once. The old Tuya `.13` files remain installed but unconfigured for rollback. Do not enable a second device owner.

Static verification passed for all accessory UUID/context/service/characteristic identities, pairing and AID/IID maps, private keys/metadata, truthful package ownership, Hive availability and grouped Home/Holiday switch identity/state. Cached accessory array order is normalised by UUID; per-accessory structure and HAP identifiers remain strict. Hive's runtime instance and PID-based socket rotate on restart by design; the stable FastWarm/Shared instance IDs do not.

One read-only preflight refresh restored a missing confirmation after the cached complete week and target already matched Home. After migration, exactly one claimed Shared native read verified all **168 FastWarm periods**, captured fingerprints and **six fresh targets** against saved Home. Saved profiles, household policy, programme history and Hive's week were retained. Home remains selected and Holiday off. No heating-setting commands were sent, and the Tuya usage meter remained byte-unchanged.

The final process-bound socket proof found **six established thermostat LAN sessions and zero public TCP connections**. This is an instantaneous process observation, not an internet-disconnection test. The new UI loaded all six friendly room cards and reported stored-key presence without returning any key. Original preflight stops and the verifier's order/ephemeral-Hive corrections remain in private evidence; they were not heating-write retries. No installation-specific configuration, addresses, identifiers, credentials or pairing records are published.

Remaining separate validation: broad multi-period local schedule-write coverage and a deliberate internet-loss test. Do not claim either was completed by package extraction. Never start a raw competing LAN client while a production provider owns a device.
