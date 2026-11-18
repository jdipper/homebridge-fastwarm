# Migration from the Tuya fork

This is an identity-preserving package migration, not a second installation for the same devices. Test and review the concrete configuration/cache projection before applying it. The deployment helper and private backups are installation-specific and are not published here.

## Preconditions

- FastWarm devices already use tested local transport in the Tuya fork.
- Each selected accessory has the reviewed ET-63 service layout, with no functional generic service/schema overrides that would be lost.
- Heating Programmes has confirmed, quiet saved state and compatible provider support (`0.1.0-jdipper.10` or later).
- Original plugin archives, complete package contents, configuration, accessory caches, HAP pairing/identifier files, private keys/metadata, profiles and operation state are backed up privately.
- The original instance ID is known and preserved explicitly. Do not generate a new ID for migrated devices.

## Configuration projection

Replace `TuyaPlatform` with `FastWarmPlatform` while retaining its exact `name` and `_bridge` values. Use the original provider `instanceId`, and project the enabled local device selections into `devices` (`deviceId`, `address`, `version`, `enabled`, model `ET-63`). Keep optional SmartLife connection options under `smartLife` only if explicit metadata refresh is wanted. Do not put local keys into configuration.

Imported names/rooms continue to come from existing metadata; omit configuration label overrides unless a deliberate permanent override is needed. Reject unsupported generic configuration rather than silently guessing at a replacement.

## Ownership and restart

1. Stop the old Tuya and shared Heating Programmes child bridges. Check process identity and confirm they are stopped; leave Hive and the parent running during file replacement.
2. Install checked archives without running package scripts. Replace exactly the reviewed shared files and add the dedicated package. Remove the old Tuya dependency/platform entry from active configuration.
3. Reassign only the six selected cache entries' package/platform ownership. Keep each UUID, context, service and characteristic identifier, HAP pairing data and child-bridge identity intact. Use the stopped cache's current bytes because sensor values may have flushed during shutdown.
4. Restart the main Homebridge service once using its UI. A child-only restart retains the old plugin path/platform mapping in the parent.
5. Verify the new provider identity and private IPC authentication, all selected devices, profiles/history, grouped Home/Holiday services, and unchanged HAP pairing/AID/IID data. Read the complete native weeks and fresh targets through the running provider, rather than opening competing raw LAN clients.

The original Tuya package can remain installed but unconfigured for rollback. It must not be enabled alongside the dedicated provider. Remove it in a later cleanup after the new installation is stable.

## Failure handling

Before a successful restart, restore only transaction-owned changes from backups while the original writer/process guards still hold. A deadline blocks new forward mutations but should not block guarded restoration.

After the main restart, stop and inspect any verification failure. Do not overwrite settings against new process ownership or blindly repeat an uncertain write. Retain private backups, file hashes and the migration journal. This migration sends no temperature, power, mode or programme write commands to thermostats.
