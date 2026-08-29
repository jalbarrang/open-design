# Install a local packaged macOS build

These steps install and run a local Electron build created with `tools-pack`.

## Requirements

- macOS on Apple Silicon (`arm64`)
- Node 24
- A completed `pnpm tools-pack mac build --to all` build

Run all commands from the repository root.

## Managed local install

This is the recommended option for testing a local build:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"

pnpm tools-pack mac install
pnpm tools-pack mac start
```

Manage the installed app with:

```bash
pnpm tools-pack mac logs
pnpm tools-pack mac stop
pnpm tools-pack mac uninstall
```

## Install from the DMG

Open the generated disk image:

```bash
open ".tmp/tools-pack/out/mac/namespaces/default/dmg/Open Design-default.dmg"
```

Drag **Open Design** into **Applications**.

The local build is not Developer ID signed or notarized. If macOS blocks the first launch:

1. Control-click **Open Design** in Applications.
2. Select **Open**.
3. Confirm the launch.

If it remains blocked, open **System Settings → Privacy & Security** and select **Open Anyway**.

## Generated artifacts

```text
.tmp/tools-pack/out/mac/namespaces/default/builder/mac-arm64/Open Design.app
.tmp/tools-pack/out/mac/namespaces/default/dmg/Open Design-default.dmg
.tmp/tools-pack/out/mac/namespaces/default/zip/Open Design-default.zip
.tmp/tools-pack/out/mac/namespaces/default/payload/Open Design-default-payload.zip
```

This is a non-portable local build. Keep the repository and `.tmp/tools-pack` directory in place while testing it.
