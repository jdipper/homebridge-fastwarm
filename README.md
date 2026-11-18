# FastWarm Local for Homebridge

`@jdipper/homebridge-fastwarm` exposes FastWarm Smart WiFi 2.0 / ET-63 thermostats in Apple Home and provides native weekly schedules to [Heating Programmes](https://github.com/jdipper/homebridge-heating-programmes).

It connects directly to configured thermostats using their Tuya 3.5 LAN protocol. Normal startup, temperature updates, target changes and schedule operations make no Tuya cloud requests. An optional, explicit SmartLife import can refresh friendly room and device names.

This is an independent integration, extracted from the [jdipper Tuya fork](https://github.com/jdipper/homebridge-tuya). Only the ET-63 model and protocol 3.5 are supported. Other Tuya thermostats are not interchangeable merely because they use SmartLife.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| FastWarm Local | Room temperature, target and thermostat controls; authenticated LAN connections; reading and delivering the native four-period, seven-day programme |
| Heating Programmes | Saved Home, Away and Holiday profiles; household presence and Holiday precedence; grouped Apple Home controls; programme editor, verification and operation history |
| Hive provider | Hive thermostat and its native programme; remains a separate provider |

Use Heating Programmes `0.1.0-jdipper.10` or later with this plugin. The shared plugin retains compatibility with the Tuya provider. The design stores the native week on each thermostat for execution by the device; a deliberate internet-loss test remains pending. Changing household profiles requires Homebridge to be running and able to reach the thermostats.

## Setup

Run the plugin as a child bridge on the same network as the thermostats. Give each thermostat a stable private IPv4 address, preferably through a DHCP reservation. Permit Homebridge to reach the thermostat's LAN service (TCP 6668). Do not expose it to the internet.

1. Add a FastWarm Local platform in Homebridge. Opening settings creates an instance ID in the unsaved settings draft. Save that ID and keep it stable.
2. Configure each ET-63 device ID, private address and protocol `3.5`. Optional names and room names override imported labels.
3. On the plugin page, store each device's 16-character local key. Keys are written to an owner-only private file; they are never placed in Homebridge's platform configuration or returned by the UI.
4. Restart the child bridge. Devices become available after an authenticated native status report. Missing keys or disconnected devices are reported as unavailable.
5. Enable the rooms and save profiles in Heating Programmes. Its editor can import the programme currently stored on a thermostat.

The optional SmartLife settings are used only by **Import names from SmartLife**. That action contacts the configured Tuya region and refreshes labels for the configured devices. It does not obtain local keys or write thermostat settings. Local keys are entered separately on the plugin page. Restart the child bridge after changing keys or importing names. Pairing a device again in SmartLife can rotate its local key.

Homebridge `1.8+` or `2.x` and a compatible Node.js version are required. Node.js 22 is the deployment baseline. Apple Home controls remain available locally when internet is unavailable, subject to the Apple Home hub/network configuration.

## Building

The initial release is distributed as a checked package archive; it has not yet been published to npm.

```sh
npm ci
npm run lint
npm test -- --runInBand
npm run build
npm pack --ignore-scripts
```

Install the resulting archive using your Homebridge installation's supported package-install procedure. A GitHub source checkout does not contain the compiled `dist` directory. Never install a second active FastWarm owner alongside an existing Tuya configuration for the same thermostats.

## Migrating from the Tuya fork

An existing installation needs a deliberate migration; adding a second platform creates duplicate accessories and competing connections. Back up Homebridge configuration, cached accessories, pairing data, private connection files and Heating Programmes data first.

Preserve the old child bridge identity, accessory UUIDs/services and original provider instance ID. The migration must replace the old platform configuration and reassign its existing cache ownership to `@jdipper/homebridge-fastwarm` / `FastWarmPlatform`. A main Homebridge restart is required once to load the new child-platform identity. See [migration details](docs/migration.md).

Existing saved profiles, logical room IDs, operation history and grouped Home/Holiday controls remain with Heating Programmes. This plugin intentionally retains private legacy `Tuya…` filenames and `tuya:` room IDs so those references remain valid.

## Verification and limits

Schedule delivery retains the tested transport queue, pacing, cancellation and full-week readback safeguards. A transport acknowledgement alone is not proof that every period was applied. Unverified or partially applied programmes require attention; the system does not silently report success or automatically retry uncertain heating writes.

The extracted runtime is covered by offline protocol, schedule, security, UI and migration-contract tests. The prior implementation has live LAN read evidence for six thermostats and a future-period write-and-restore test on one device. Broad local multi-period writes and a deliberate WAN-disconnection test remain separate validation work. Extraction itself does not change a thermostat programme or target.

Release `0.1.0-jdipper.1` has completed a backed-up migration with Heating Programmes `.10`: all 168 stored periods and six fresh current targets matched Home, pairing and grouped controls were preserved, and the provider held six LAN sessions with no public TCP connections or Tuya HTTP attempts during verification. The complete plugin suite passes 538 tests and [Linux CI](https://github.com/jdipper/homebridge-fastwarm/actions/runs/44306032533).

See [architecture](docs/architecture.md), [handover](docs/codex-handover.md) and [release notes](CHANGELOG.md). Keep local keys, account credentials, serial numbers, addresses and Homebridge backups out of public issues and logs.

## Licence

MIT. Original Tuya attribution is retained in [LICENSE](LICENSE) and [NOTICE](NOTICE).
