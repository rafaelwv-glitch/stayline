"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("staylineTeams", {
  client: "stayline",
});
