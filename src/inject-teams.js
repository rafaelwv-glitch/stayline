"use strict";

/**
 * Injected into the Teams page after load. Spoofs visibility and blocks Idle
 * Detection so presence lock can hold. Not used on login.microsoftonline.com —
 * passkey / Authenticator popups need real focus and blur.
 */
const INJECT_TEAMS_JS = `
(() => {
  if (window.__staylineInjected) return true;
  if (/login\\.microsoftonline|microsoftazuread-sso|msauth\\.net|login\\.live/.test(location.hostname)) {
    return false;
  }
  window.__staylineInjected = true;

  const spoof = () => {
    try {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    } catch {}
  };
  spoof();

  document.addEventListener("visibilitychange", (event) => {
    event.stopImmediatePropagation();
  }, true);

  try {
    if (navigator.idle && navigator.idle.queryState) {
      navigator.idle.queryState = async () => ({ userState: "active", screenState: "unlocked" });
    }
  } catch {}

  return true;
})();
`;

module.exports = { INJECT_TEAMS_JS };
