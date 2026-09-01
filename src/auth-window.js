"use strict";

const { BrowserWindow } = require("electron");
const path = require("node:path");
const { INJECT_AUTH_JS } = require("./inject-auth");

const authByAccount = new Map();
const authContents = new WeakSet();

function isLoginHost(url) {
  try {
    const host = new URL(url).hostname;
    return /^(login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|login\.windows\.net|device\.login\.microsoftonline\.com)$/i.test(
      host,
    );
  } catch {
    return false;
  }
}

function isAuthContents(wc) {
  return Boolean(wc) && authContents.has(wc);
}

function injectAuth(wc) {
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(INJECT_AUTH_JS, true).catch(() => {});
}

function openAuthWindow({ account, url, icon, onSignedIn, onLog }) {
  const existing = authByAccount.get(account.id);
  if (existing && !existing.isDestroyed()) {
    const current = existing.webContents.getURL();
    if (!isLoginHost(current)) existing.loadURL(url);
    existing.show();
    existing.focus();
    existing.moveTop();
    return existing;
  }

  const win = new BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 420,
    minHeight: 560,
    parent: undefined,
    modal: false,
    frame: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    title: "Sign in · Stayline",
    backgroundColor: "#ffffff",
    icon,
    webPreferences: {
      partition: account.partition,
      preload: path.join(__dirname, "preload-teams.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  authByAccount.set(account.id, win);
  authContents.add(win.webContents);
  win.setAlwaysOnTop(true, "screen-saver");
  onLog?.({ at: Date.now(), text: "sign-in window opened" });

  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  wc.on("dom-ready", () => injectAuth(wc));
  wc.on("did-finish-load", () => injectAuth(wc));

  const maybeFinish = (_event, nextUrl) => {
    if (!nextUrl || isLoginHost(nextUrl)) return;
    if (!/teams\.microsoft\.com/.test(nextUrl)) return;
    onSignedIn?.(nextUrl);
    if (!win.isDestroyed()) win.close();
  };
  wc.on("did-navigate", maybeFinish);
  wc.on("did-redirect-navigation", maybeFinish);
  wc.on("will-redirect", maybeFinish);

  win.on("closed", () => {
    if (authByAccount.get(account.id) === win) authByAccount.delete(account.id);
  });

  const bump = () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
    win.moveTop();
  };
  win.once("ready-to-show", bump);
  setTimeout(bump, 300);
  setTimeout(bump, 1200);

  win.loadURL(url);
  return win;
}

function closeAuthWindow(accountId) {
  const win = authByAccount.get(accountId);
  if (win && !win.isDestroyed()) win.close();
  authByAccount.delete(accountId);
}

module.exports = {
  isLoginHost,
  isAuthContents,
  openAuthWindow,
  closeAuthWindow,
  injectAuth,
};
