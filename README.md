# Stayline

Unofficial Linux client for the Microsoft Teams web app. Packaged as a single **AppImage**. Your presence is **overridden by Stayline** — automatic Away is blocked, and the status you pick is re-asserted until you change it.

Stayline is not affiliated with Microsoft. Microsoft Teams is a trademark of Microsoft Corporation.

## Why

The Teams PWA on Linux still flips you Away after a few idle minutes, even when you are at the desk. Stayline loads the same web client (`https://teams.microsoft.com/v2/`) in a Chromium shell that:

1. Calls Microsoft Graph `setUserPreferredPresence` with your chosen status (reuses the signed-in Teams token — no extra Azure app).
2. Keeps a `setPresence` session heartbeat so preferred presence has a live client.
3. Sends Chromium input keepalives and spoofs page visibility so the web client itself does not idle.
4. Denies the Idle Detection API.

## Install

Download `Stayline-*-x86_64.AppImage` from [Releases](https://github.com/rafaelwv-glitch/stayline/releases/latest).

```bash
chmod +x Stayline-1.1.2-x86_64.AppImage
./Stayline-1.1.2-x86_64.AppImage
```

Ubuntu 24.04+ may need FUSE:

```bash
sudo apt install libfuse2
```

Sign in with your work account in the window. Stayline never sees your password.

If an older Stayline is already in the tray, the new AppImage will only focus that old window. Choose **Quit** from the tray, then start `Stayline-1.1.2-x86_64.AppImage`. The top bar must show the version number and an **Add account** button.

## Multiple tenants

The Teams **web** client stores Entra cookies in one browser profile. Signing into a second work account from another home tenant overwrites the first. Stayline does not try to fight that inside one cookie jar.

Instead, each account gets its own Chromium partition (`persist:stayline-<id>`). Add another tenant from the top bar **+**, the Accounts menu (`Ctrl+Shift+N`), or the tray. Switching uses `Alt+1`…`Alt+9`.

- Existing Stayline sessions keep the original `persist:stayline` partition, so you are not signed out on upgrade.
- Guest organisations of the **same** identity still use Teams’ own org switcher.
- Distinct work identities (different home tenants) are Stayline accounts.
- Presence lock keeps running on accounts you are not looking at.
- Meeting pop-outs stay in the partition of the account that opened them.

## Presence lock

The top bar and the tray menu both control the lock for the **active** account.

| Status | Graph availability / activity |
| --- | --- |
| Available | Available / Available |
| Busy | Busy / Busy |
| Do not disturb | DoNotDisturb / DoNotDisturb |
| Be right back | BeRightBack / BeRightBack |
| Away | Away / Away |
| Appear offline | Offline / OffWork |

While the lock is on, Teams cannot auto-flip you to Away. Calendar “in a meeting” can still surface from Exchange; the lock re-asserts your preferred presence on the heartbeat.

Config file: `~/.config/stayline/config.json`

```json
{
  "url": "https://teams.microsoft.com/v2/",
  "lockEnabled": true,
  "lockedStatus": "Available",
  "pingIntervalSec": 45,
  "presenceRefreshSec": 240,
  "preferredPresenceHours": 8,
  "minimizeToTray": true,
  "hardwareAcceleration": true,
  "activeAccountId": "default",
  "accounts": [
    {
      "id": "default",
      "label": "Account 1",
      "partition": "persist:stayline",
      "lockEnabled": true,
      "lockedStatus": "Available"
    }
  ],
  "features": {
    "pinchZoom": true,
    "overscrollHistory": true,
    "touchMode": true
  }
}
```

## Feature parity with the Teams PWA

Stayline enables the same Chromium features as an installed Teams PWA:

- Trackpad pinch zoom and Ctrl-wheel zoom
- Two-finger overscroll history (back / forward)
- Touch events and long-press context menus
- Kinetic scrolling
- Drag-and-drop files into chat
- PipeWire screen capture on Wayland (`WebRTCPipeWireCapturer`)
- Mic, camera, notifications, PiP, media keys
- `msteams:` / `ms-teams:` protocol links
- Meeting pop-outs keep the same session

## Build from source

Needs Node 22+ and a Linux host (or GitHub Actions).

```bash
npm install
node scripts/generate-icons.js
npx electron-builder --linux AppImage --x64
```

The AppImage lands in `dist/`.

```bash
npm start
```

runs the wrapper without packaging.

## Policy

Presence override uses your existing Teams session. Follow your organisation’s acceptable-use rules. This is an unofficial tool.

## License

MIT. See [LICENSE](LICENSE).
