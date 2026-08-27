"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("packagedGraphJourney", {
  start: () => ipcRenderer.invoke("p1-3:packaged-graph:start"),
  acknowledge: (receipt) =>
    ipcRenderer.invoke("p1-3:packaged-graph:acknowledge", receipt),
});
