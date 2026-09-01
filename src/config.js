"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { migrateAccounts, syncActiveAccount } = require("./accounts");

const DEFAULTS = {
  url: "https://teams.microsoft.com/v2/",
  lockEnabled: true,
  lockedStatus: "Available",
  pingIntervalSec: 45,
  presenceRefreshSec: 240,
  preferredPresenceHours: 8,
  minimizeToTray: true,
  hardwareAcceleration: true,
  openAtLogin: false,
  partition: "persist:stayline",
  accounts: [],
  activeAccountId: "default",
  features: {
    pinchZoom: true,
    overscrollHistory: true,
    touchMode: true,
  },
};

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return migrateAccounts({
      ...DEFAULTS,
      ...parsed,
      features: { ...DEFAULTS.features, ...(parsed.features || {}) },
    });
  } catch {
    return migrateAccounts({ ...DEFAULTS, features: { ...DEFAULTS.features } });
  }
}

function saveConfig(config) {
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  const next = migrateAccounts(
    syncActiveAccount({
      ...DEFAULTS,
      ...config,
      features: { ...DEFAULTS.features, ...(config.features || {}) },
    }),
  );
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return next;
}

function loadWindowState() {
  const file = path.join(app.getPath("userData"), "window.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { width: 1280, height: 800, x: undefined, y: undefined, isMaximized: false };
  }
}

function saveWindowState(bounds) {
  const file = path.join(app.getPath("userData"), "window.json");
  fs.writeFileSync(file, JSON.stringify(bounds, null, 2));
}

module.exports = {
  DEFAULTS,
  configPath,
  loadConfig,
  saveConfig,
  loadWindowState,
  saveWindowState,
};
