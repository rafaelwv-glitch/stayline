"use strict";

const { app, BrowserWindow, BrowserView, ipcMain, shell, Menu, session, nativeTheme } = require("electron");
const path = require("node:path");
const { DEFAULTS, loadConfig, saveConfig, loadWindowState, saveWindowState } = require("./config");
const { applyGestureParity } = require("./gestures");
const { PresenceLock } = require("./presence-lock");
const { INJECT_TEAMS_JS } = require("./inject-teams");
const { createTray } = require("./tray");

const CHROME_HEIGHT = 44;
const TEAMS_HOST_RE = /(^|\.)((microsoft|microsoftonline|office|office365|live|skype|teams)\.com)$/i;

let mainWindow = null;
let teamsView = null;
let config = null;
let presence = null;
let trayApi = null;
let quitting = false;

nativeTheme.themeSource = "dark";
app.setName("Stayline");
app.setAppUserModelId("dev.stayline.app");
applyGestureParity(DEFAULTS);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((a) => a.startsWith("msteams:") || a.startsWith("ms-teams:"));
    if (url && teamsView) teamsView.webContents.loadURL(translateProtocol(url));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    config = loadConfig();
    if (config.openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true });
    }
    createMainWindow();
    registerProtocols();
  });
}

app.on("before-quit", () => {
  quitting = true;
  if (presence) presence.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow) mainWindow.show();
});

function createMainWindow() {
  const state = loadWindowState();
  const icon = path.join(__dirname, "..", "assets", "icons", "512x512.png");

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0b0d",
    autoHideMenuBar: true,
    icon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-chrome.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, "chrome", "index.html"));
  installAppMenu();

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    persistBounds();
    if (!quitting && config.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("resize", layoutTeams);
  mainWindow.on("maximize", layoutTeams);
  mainWindow.on("unmaximize", layoutTeams);

  const ses = session.fromPartition(config.partition);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ video: true, audio: "loopback" });
  }, { useSystemPicker: true });
  ses.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ title: "Save file · Stayline" });
  });

  teamsView = new BrowserView({
    webPreferences: {
      partition: config.partition,
      preload: path.join(__dirname, "preload-teams.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.setBrowserView(teamsView);
  layoutTeams();

  const wc = teamsView.webContents;
  wc.setBackgroundThrottling(false);
  wc.setVisualZoomLevelLimits(1, 3).catch(() => {});
  wc.setWindowOpenHandler(onWindowOpen);
  wc.on("did-finish-load", () => {
    wc.executeJavaScript(INJECT_TEAMS_JS, true).catch(() => {});
    if (presence) presence.injectVisibility();
    pushChromeState();
  });
  wc.on("page-title-updated", (_e, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title ? `${title} · Stayline` : "Stayline");
    }
  });
  wc.on("zoom-changed", (_e, zoomDirection) => {
    if (!config.gestures?.pinchZoom) return;
    const next = wc.getZoomFactor() + (zoomDirection === "in" ? 0.1 : -0.1);
    wc.setZoomFactor(Math.min(3, Math.max(0.7, next)));
  });
  wc.on("did-navigate", () => pushChromeState());
  wc.on("did-navigate-in-page", () => pushChromeState());
  wc.setUserAgent(cleanUserAgent(ses.getUserAgent()));

  presence = new PresenceLock({
    session: ses,
    getContents: () => (teamsView && !teamsView.webContents.isDestroyed() ? teamsView.webContents : null),
    getConfig: () => config,
    userData: app.getPath("userData"),
    onLog: (entry) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("stayline:log", entry);
      }
    },
  });
  presence.start();

  trayApi = createTray({
    getMainWindow: () => mainWindow,
    getConfig: () => config,
    saveConfig: (next) => {
      config = saveConfig(next);
      pushChromeState();
    },
    presence,
    iconPath: icon,
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.setBackgroundThrottling(false);
    contents.on("did-finish-load", () => {
      const url = contents.getURL();
      if (/teams\.microsoft\.com|microsoftonline|office\.com/.test(url)) {
        contents.executeJavaScript(INJECT_TEAMS_JS, true).catch(() => {});
      }
    });
  });

  wc.loadURL(config.url);
  wireIpc();
}

function layoutTeams() {
  if (!mainWindow || !teamsView) return;
  const [width, height] = mainWindow.getContentSize();
  teamsView.setBounds({
    x: 0,
    y: CHROME_HEIGHT,
    width,
    height: Math.max(120, height - CHROME_HEIGHT),
  });
}

function persistBounds() {
  if (!mainWindow) return;
  const isMaximized = mainWindow.isMaximized();
  const bounds = isMaximized ? loadWindowState() : mainWindow.getBounds();
  saveWindowState({ ...bounds, isMaximized });
}

function cleanUserAgent(ua) {
  return ua.replace(/\sElectron\/[\d.]+/g, "").replace(/\sStayline\/[\d.]+/g, "");
}

function onWindowOpen({ url }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { action: "deny" };
  }
  if (TEAMS_HOST_RE.test(parsed.hostname) || /microsoftonline|login\.live/.test(parsed.hostname)) {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        backgroundColor: "#0a0b0d",
        webPreferences: {
          partition: config.partition,
          contextIsolation: true,
          preload: path.join(__dirname, "preload-teams.js"),
          backgroundThrottling: false,
        },
      },
    };
  }
  shell.openExternal(url);
  return { action: "deny" };
}

function translateProtocol(url) {
  return url
    .replace(/^msteams:/, "https://teams.microsoft.com/")
    .replace(/^ms-teams:/, "https://teams.microsoft.com/");
}

function registerProtocols() {
  if (!app.isDefaultProtocolClient("msteams")) {
    app.setAsDefaultProtocolClient("msteams");
  }
  if (!app.isDefaultProtocolClient("ms-teams")) {
    app.setAsDefaultProtocolClient("ms-teams");
  }
}

function wireIpc() {
  ipcMain.handle("stayline:get-state", () => chromeState());
  ipcMain.handle("stayline:set-lock", (_e, enabled) => {
    config.lockEnabled = Boolean(enabled);
    config = saveConfig(config);
    presence.setEnabled(config.lockEnabled);
    trayApi?.rebuild();
    return chromeState();
  });
  ipcMain.handle("stayline:set-status", (_e, status) => {
    config.lockedStatus = String(status);
    config = saveConfig(config);
    presence.setStatus(config.lockedStatus);
    trayApi?.rebuild();
    return chromeState();
  });
  ipcMain.handle("stayline:reload", () => {
    if (teamsView) teamsView.webContents.reload();
    return true;
  });
  ipcMain.handle("stayline:back", () => {
    if (teamsView && teamsView.webContents.canGoBack()) teamsView.webContents.goBack();
    return true;
  });
  ipcMain.handle("stayline:forward", () => {
    if (teamsView && teamsView.webContents.canGoForward()) teamsView.webContents.goForward();
    return true;
  });
  ipcMain.handle("stayline:zoom", (_e, delta) => {
    if (!teamsView) return 1;
    const next = teamsView.webContents.getZoomFactor() + Number(delta);
    const clamped = Math.min(3, Math.max(0.7, next));
    teamsView.webContents.setZoomFactor(clamped);
    return clamped;
  });
}

function chromeState() {
  return {
    lockEnabled: config.lockEnabled,
    lockedStatus: config.lockedStatus,
    pingIntervalSec: config.pingIntervalSec,
    url: config.url,
    version: app.getVersion(),
  };
}

function pushChromeState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("stayline:state", chromeState());
  }
}

function installAppMenu() {
  const template = [
    {
      label: "Stayline",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Presence lock",
          type: "checkbox",
          checked: config.lockEnabled,
          click: (item) => {
            config.lockEnabled = item.checked;
            config = saveConfig(config);
            presence.setEnabled(item.checked);
            trayApi?.rebuild();
            pushChromeState();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload Teams", accelerator: "CmdOrCtrl+R", click: () => teamsView?.webContents.reload() },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "History",
      submenu: [
        { label: "Back", accelerator: "Alt+Left", click: () => teamsView?.webContents.goBack() },
        { label: "Forward", accelerator: "Alt+Right", click: () => teamsView?.webContents.goForward() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
