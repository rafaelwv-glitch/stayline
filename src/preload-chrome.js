"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stayline", {
  getState: () => ipcRenderer.invoke("stayline:get-state"),
  setLock: (enabled) => ipcRenderer.invoke("stayline:set-lock", enabled),
  setStatus: (status) => ipcRenderer.invoke("stayline:set-status", status),
  reload: () => ipcRenderer.invoke("stayline:reload"),
  back: () => ipcRenderer.invoke("stayline:back"),
  forward: () => ipcRenderer.invoke("stayline:forward"),
  zoom: (delta) => ipcRenderer.invoke("stayline:zoom", delta),
  onState: (fn) => {
    const listener = (_e, state) => fn(state);
    ipcRenderer.on("stayline:state", listener);
    return () => ipcRenderer.removeListener("stayline:state", listener);
  },
  onLog: (fn) => {
    const listener = (_e, entry) => fn(entry);
    ipcRenderer.on("stayline:log", listener);
    return () => ipcRenderer.removeListener("stayline:log", listener);
  },
});
