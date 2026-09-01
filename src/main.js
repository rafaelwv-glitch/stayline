"use strict";

const { app, BrowserWindow, BrowserView, ipcMain, shell, Menu, session, nativeTheme } = require("electron");
const path = require("node:path");
const { DEFAULTS, loadConfig, saveConfig, loadWindowState, saveWindowState } = require("./config");
const { applyFeatureParity } = require("./features");
const { PresenceLock } = require("./presence-lock");
const { INJECT_TEAMS_JS } = require("./inject-teams");
const { createTray } = require("./tray");
const {
  createAccount,
  applyIdentity,
  accountMenuLabel,
  publicAccount,
} = require("./accounts");

const CHROME_HEIGHT = 44;
const TEAMS_HOST_RE = /(^|\.)((microsoft|microsoftonline|office|office365|live|skype|teams)\.com)$/i;

let mainWindow = null;
let teamsView = null;
let config = null;
let presence = null;
let trayApi = null;
let quitting = false;
const slots = new Map();
const preparedSessions = new WeakSet();

nativeTheme.themeSource = "dark";
app.setName("Stayline");
app.setAppUserModelId("dev.stayline.app");
applyFeatureParity(DEFAULTS);

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
  for (const slot of slots.values()) slot.presence.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow) mainWindow.show();
});

function activeAccount() {
  return config.accounts.find((account) => account.id === config.activeAccountId) || config.accounts[0];
}

function persist() {
  config = saveConfig(config);
  return config;
}

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
  rebuildMenu();

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

  for (const account of config.accounts) {
    ensureSlot(account);
  }
  showAccount(activeAccount().id, { persist: false, focus: false });

  trayApi = createTray({
    getMainWindow: () => mainWindow,
    getConfig: () => config,
    saveConfig: (next) => {
      config = next;
      persist();
      const slot = slots.get(config.activeAccountId);
      if (slot) {
        slot.presence.setEnabled(config.lockEnabled);
        slot.presence.setStatus(config.lockedStatus);
      }
      pushChromeState();
      rebuildMenu();
    },
    getAccounts: () => config.accounts,
    getActiveId: () => config.activeAccountId,
    switchAccount: (id) => showAccount(id),
    addAccount,
    presence: {
      setEnabled: (enabled) => slots.get(config.activeAccountId)?.presence.setEnabled(enabled),
      setStatus: (status) => slots.get(config.activeAccountId)?.presence.setStatus(status),
    },
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

  wireIpc();
}

function ensureSession(partition) {
  const ses = session.fromPartition(partition);
  if (preparedSessions.has(ses)) return ses;
  preparedSessions.add(ses);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      callback({ video: true, audio: "loopback" });
    },
    { useSystemPicker: true },
  );
  ses.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ title: "Save file · Stayline" });
  });
  return ses;
}

function ensureSlot(account) {
  if (slots.has(account.id)) return slots.get(account.id);

  const ses = ensureSession(account.partition);
  const view = new BrowserView({
    webPreferences: {
      partition: account.partition,
      preload: path.join(__dirname, "preload-teams.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  const wc = view.webContents;
  wc.setBackgroundThrottling(false);
  wc.setVisualZoomLevelLimits(1, 3).catch(() => {});
  wc.setWindowOpenHandler((details) => onWindowOpen(details, account.partition));
  wc.on("did-finish-load", () => {
    wc.executeJavaScript(INJECT_TEAMS_JS, true).catch(() => {});
    slots.get(account.id)?.presence.injectVisibility();
    if (config.activeAccountId === account.id) pushChromeState();
  });
  wc.on("page-title-updated", (_e, title) => {
    if (config.activeAccountId !== account.id) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title ? `${title} · Stayline` : "Stayline");
    }
  });
  wc.on("zoom-changed", (_e, zoomDirection) => {
    if (!config.features?.pinchZoom) return;
    const next = wc.getZoomFactor() + (zoomDirection === "in" ? 0.1 : -0.1);
    wc.setZoomFactor(Math.min(3, Math.max(0.7, next)));
  });
  wc.on("did-navigate", () => {
    if (config.activeAccountId === account.id) pushChromeState();
  });
  wc.on("did-navigate-in-page", () => {
    if (config.activeAccountId === account.id) pushChromeState();
  });
  wc.setUserAgent(cleanUserAgent(ses.getUserAgent()));

  const lock = new PresenceLock({
    session: ses,
    accountId: account.id,
    getContents: () => {
      const slot = slots.get(account.id);
      return slot && !slot.view.webContents.isDestroyed() ? slot.view.webContents : null;
    },
    getConfig: () => {
      const acct = config.accounts.find((item) => item.id === account.id) || account;
      return {
        ...config,
        lockEnabled: acct.lockEnabled,
        lockedStatus: acct.lockedStatus,
      };
    },
    userData: app.getPath("userData"),
    onLog: (entry) => {
      if (config.activeAccountId !== account.id) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("stayline:log", entry);
      }
    },
    onIdentity: (profile) => rememberIdentity(account.id, profile),
  });
  lock.start();

  const slot = { accountId: account.id, view, session: ses, presence: lock };
  slots.set(account.id, slot);
  wc.loadURL(config.url);
  return slot;
}

function showAccount(id, opts = {}) {
  const account = config.accounts.find((item) => item.id === id);
  if (!account) return chromeState();
  const slot = ensureSlot(account);

  config.activeAccountId = account.id;
  config.lockEnabled = account.lockEnabled;
  config.lockedStatus = account.lockedStatus;
  config.partition = account.partition;
  if (opts.persist !== false) persist();

  teamsView = slot.view;
  presence = slot.presence;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBrowserView(slot.view);
    layoutTeams();
  }
  pushChromeState();
  trayApi?.rebuild();
  rebuildMenu();
  if (opts.focus !== false && mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  return chromeState();
}

function addAccount() {
  const account = createAccount({
    label: `Account ${config.accounts.length + 1}`,
  });
  config.accounts.push(account);
  persist();
  ensureSlot(account);
  return showAccount(account.id);
}

async function removeAccount(id) {
  if (config.accounts.length <= 1) return chromeState();
  const slot = slots.get(id);
  if (slot) {
    slot.presence.stop();
    try {
      await slot.session.clearStorageData();
    } catch {
      /* ignore */
    }
    if (mainWindow && !mainWindow.isDestroyed() && teamsView === slot.view) {
      mainWindow.setBrowserView(null);
    }
    if (!slot.view.webContents.isDestroyed()) {
      slot.view.webContents.close();
    }
    slots.delete(id);
  }
  config.accounts = config.accounts.filter((account) => account.id !== id);
  const nextId = config.activeAccountId === id ? config.accounts[0].id : config.activeAccountId;
  persist();
  return showAccount(nextId);
}

function renameAccount(id, label) {
  const account = config.accounts.find((item) => item.id === id);
  if (!account) return chromeState();
  const next = String(label || "").trim();
  if (!next) return chromeState();
  account.label = next;
  account.labelCustom = true;
  persist();
  pushChromeState();
  trayApi?.rebuild();
  rebuildMenu();
  return chromeState();
}

function rememberIdentity(id, profile) {
  const index = config.accounts.findIndex((item) => item.id === id);
  if (index < 0) return;
  config.accounts[index] = applyIdentity(config.accounts[index], profile);
  persist();
  pushChromeState();
  trayApi?.rebuild();
  rebuildMenu();
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

function onWindowOpen({ url }, partition) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { action: "deny" };
  }
  const sessionPartition = partition || activeAccount().partition;
  if (TEAMS_HOST_RE.test(parsed.hostname) || /microsoftonline|login\.live/.test(parsed.hostname)) {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        backgroundColor: "#0a0b0d",
        webPreferences: {
          partition: sessionPartition,
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
    const account = activeAccount();
    account.lockEnabled = Boolean(enabled);
    config.lockEnabled = account.lockEnabled;
    persist();
    slots.get(account.id)?.presence.setEnabled(account.lockEnabled);
    trayApi?.rebuild();
    rebuildMenu();
    return chromeState();
  });
  ipcMain.handle("stayline:set-status", (_e, status) => {
    const account = activeAccount();
    account.lockedStatus = String(status);
    config.lockedStatus = account.lockedStatus;
    persist();
    slots.get(account.id)?.presence.setStatus(account.lockedStatus);
    trayApi?.rebuild();
    rebuildMenu();
    return chromeState();
  });
  ipcMain.handle("stayline:switch-account", (_e, id) => showAccount(String(id)));
  ipcMain.handle("stayline:add-account", () => addAccount());
  ipcMain.handle("stayline:remove-account", (_e, id) => removeAccount(String(id || activeAccount().id)));
  ipcMain.handle("stayline:rename-account", (_e, payload) => {
    const id = payload?.id || activeAccount().id;
    return renameAccount(id, payload?.label);
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
    accounts: config.accounts.map(publicAccount),
    activeAccountId: config.activeAccountId,
  };
}

function pushChromeState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("stayline:state", chromeState());
  }
}

function rebuildMenu() {
  const accountItems = config.accounts.map((account, index) => ({
    label: accountMenuLabel(account),
    type: "radio",
    checked: account.id === config.activeAccountId,
    accelerator: index < 9 ? `Alt+${index + 1}` : undefined,
    click: () => showAccount(account.id),
  }));

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
            const account = activeAccount();
            account.lockEnabled = item.checked;
            config.lockEnabled = item.checked;
            persist();
            slots.get(account.id)?.presence.setEnabled(item.checked);
            trayApi?.rebuild();
            pushChromeState();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Accounts",
      submenu: [
        ...accountItems,
        { type: "separator" },
        {
          label: "Add account…",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => addAccount(),
        },
        {
          label: "Rename account…",
          click: () => promptRename(),
        },
        {
          label: "Remove account",
          enabled: config.accounts.length > 1,
          click: () => removeAccount(config.activeAccountId),
        },
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

async function promptRename() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const current = activeAccount().label;
  const next = await mainWindow.webContents.executeJavaScript(
    `window.prompt("Name this account", ${JSON.stringify(current)})`,
  );
  if (next) renameAccount(config.activeAccountId, next);
}
