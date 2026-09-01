"use strict";

const { Tray, Menu, nativeImage, app } = require("electron");
const path = require("node:path");
const { STATUS_MAP } = require("./presence-lock");

function createTray({ getMainWindow, getConfig, saveConfig, presence, iconPath }) {
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "icons", "icon.png"));
  }
  const tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip("Stayline");

  const rebuild = () => {
    const cfg = getConfig();
    const statusItems = Object.keys(STATUS_MAP).map((id) => ({
      label: id === "DoNotDisturb" ? "Do not disturb" : id === "BeRightBack" ? "Be right back" : id,
      type: "radio",
      checked: cfg.lockedStatus === id,
      click: () => {
        cfg.lockedStatus = id;
        saveConfig(cfg);
        presence.setStatus(id);
        rebuild();
      },
    }));

    const menu = Menu.buildFromTemplate([
      { label: "Stayline", enabled: false },
      { type: "separator" },
      {
        label: "Presence lock",
        type: "checkbox",
        checked: cfg.lockEnabled,
        click: (item) => {
          cfg.lockEnabled = item.checked;
          saveConfig(cfg);
          presence.setEnabled(item.checked);
          rebuild();
        },
      },
      { label: "Forced status", submenu: statusItems },
      { type: "separator" },
      {
        label: "Show window",
        click: () => {
          const win = getMainWindow();
          if (!win) return;
          win.show();
          win.focus();
        },
      },
      {
        label: "Reload Teams",
        click: () => {
          const win = getMainWindow();
          const view = win && win.getBrowserView();
          if (view) view.webContents.reload();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
  };

  tray.on("click", () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
  });

  rebuild();
  return { tray, rebuild };
}

module.exports = { createTray };
