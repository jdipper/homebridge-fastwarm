# Changelog

## 0.1.0-jdipper.1

- Extract the tested FastWarm ET-63 local transport, temperature controls and native schedule provider into a dedicated Homebridge plugin.
- Retain queueing, pacing, verification, cancellation and active-target alignment safeguards from the Tuya fork.
- Acquire the compatible provider-owner lock before opening LAN connections or seeding metadata.
- Keep private keys, cached accessory UUIDs, logical room IDs, IPC discovery and operation-history references stable during migration.
- Provide local setup with private key-presence indicators and friendly room labels; keep explicit optional SmartLife import separate from native startup.
- Support Heating Programmes `0.1.0-jdipper.10`, which retains household Home/Away/Holiday profiles and grouped controls.
