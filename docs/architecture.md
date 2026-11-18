# Architecture

`FastWarmPlatform` loads a strict device allowlist, private local keys and saved ET-63 metadata. It starts the authenticated local programme-provider server and acquires the legacy-compatible owner lock **before opening any thermostat connection or saving new metadata**. Another active owner prevents startup. This complements configuration-level migration; the older Tuya plugin must still be stopped and removed from active configuration.

The native path is `FastWarmLanClient` → `FastWarmLanController` → device manager / schedule manager. It retains the Tuya 3.5 session, report handling, serialised per-device requests, bounded schedule delivery and readback. Cached temperatures do not prove a live connection: devices start offline and become available only after fresh authenticated native observations.

Only the thermostat accessory and required temperature characteristics are shipped. Generic Tuya device handlers, schema overrides and MQTT client code are omitted. Internal `TuyaOpenAPI` and `TuyaOpenMQ` compatibility surfaces reject cloud actions or act as an in-process event bus; neither starts a cloud connection. The real SmartLife API implementation lives separately under `cloud/` and is loaded only by an explicit metadata-import request.

## Shared provider contract

The descriptor advertises `@jdipper/homebridge-fastwarm`. Heating Programmes accepts this exact identity or the exact older Tuya package identity; it does not accept arbitrary plugin names. A prepared write is invalidated if provider ownership changes.

The following names deliberately remain stable across extraction:

- `TuyaProgrammeProvider.<instance>.json` and `tuya-programmes-<instance>.sock` for private local IPC discovery.
- The existing provider owner-lock namespace.
- `FastWarmLocalKeys.<instance>.json` and `FastWarmLocalMetadata.<instance>.json` for private device setup.
- Logical `tuya:<device-id>` room IDs and `heating-operations/tuya-<instance>` history.

These are compatibility identifiers, not cloud dependencies. The new package owns local room controls and native schedule delivery. Household profiles, transitions, delayed presence changes, Holiday state, history, and Apple Home programme switches remain in Heating Programmes.

## Data boundaries

Local keys are kept in owner-only private files using bounded, no-follow reads and atomic replacement. UI read endpoints expose key presence only. Instance/device selection is validated before writes. Optional SmartLife credentials stay in Homebridge's private configuration and are never required for native startup.

The public source, tests and package must contain only synthetic fixtures and generic documentation. Public Git history starts from a clean extraction rather than the previous working repository's history. No runtime state, pairing data, device identifiers or deployment evidence belongs in this repository.
