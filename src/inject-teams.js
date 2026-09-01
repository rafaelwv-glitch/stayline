"use strict";

/**
 * Injected into the Teams page after load. Spoofs visibility, blocks Idle
 * Detection, and keeps Chromium from reporting the document as hidden.
 */
const INJECT_TEAMS_JS = `
(() => {
  if (window.__staylineInjected) return true;
  window.__staylineInjected = true;

  const spoof = () => {
    try {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
    } catch {}
  };
  spoof();

  document.addEventListener("visibilitychange", (event) => {
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener("pagehide", (event) => {
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener("blur", (event) => {
    event.stopImmediatePropagation();
  }, true);

  try {
    if (navigator.idle && navigator.idle.queryState) {
      navigator.idle.queryState = async () => ({ userState: "active", screenState: "unlocked" });
    }
  } catch {}

  try {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
    if (desc && desc.configurable) {
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => false });
    }
  } catch {}

  return true;
})();
`;

module.exports = { INJECT_TEAMS_JS };
