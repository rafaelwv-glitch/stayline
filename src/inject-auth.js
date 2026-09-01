"use strict";

/**
 * Runs in the Microsoft login page. Chromium on Linux often never paints the
 * passkey sheet, so navigator.credentials.get hangs with no timeout. Abort it
 * and offer a one-click path to Authenticator / another method.
 */
const INJECT_AUTH_JS = `
(() => {
  if (window.__staylineAuth) return true;
  window.__staylineAuth = true;

  const origGet = navigator.credentials && navigator.credentials.get
    ? navigator.credentials.get.bind(navigator.credentials)
    : null;
  if (origGet) {
    navigator.credentials.get = (opts = {}) => {
      if (!opts.publicKey) return origGet(opts);
      const ctrl = new AbortController();
      const timer = setTimeout(() => {
        try { ctrl.abort(); } catch {}
      }, 7000);
      if (opts.signal) {
        if (opts.signal.aborted) ctrl.abort();
        else opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
      }
      return origGet(Object.assign({}, opts, { signal: ctrl.signal }))
        .finally(() => clearTimeout(timer));
    };
  }

  const OTHER = [
    "sign in another way",
    "other ways to sign in",
    "use a different",
    "use another method",
    "i have a code",
    "authenticator",
    "andere anmelde",
    "anderes verfahren",
    "andere methode",
    "weitere optionen",
    "mehr optionen",
    "andere option",
  ];
  const FIDO = /sicherheitsfenster|security window|passkey|fido|sicherheitsschl[üu]ssel|security key|fingerprint|fingerabdruck|gesichtserkennung|windows hello/i;

  function visible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
  }

  function pickOther() {
    const nodes = Array.from(document.querySelectorAll("a,button,div[role=button],span[role=button],input[type=submit]"));
    const hit = nodes.find((n) => {
      const t = ((n.innerText || n.textContent || n.getAttribute("aria-label") || "") + "").toLowerCase();
      return visible(n) && OTHER.some((k) => t.includes(k));
    });
    if (hit) { hit.click(); return true; }
    const back = document.querySelector("#idBtn_Back, #idA_Back, button[aria-label='Back'], a[aria-label='Back'], button[title='Back']");
    if (back) { back.click(); return true; }
    const arrow = nodes.find((n) => (n.getAttribute("aria-label") || "").toLowerCase() === "back" || (n.textContent || "").trim() === "←");
    if (arrow) { arrow.click(); return true; }
    if (history.length > 1) { history.back(); return true; }
    return false;
  }

  function banner() {
    if (document.getElementById("stayline-mfa")) return;
    const el = document.createElement("div");
    el.id = "stayline-mfa";
    el.style.cssText = "position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;padding:14px 16px;border-radius:12px;background:#121417;color:#ececea;font:14px/1.4 Segoe UI,system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.45);display:flex;gap:12px;align-items:center;justify-content:space-between";
    const copy = document.createElement("div");
    copy.innerHTML = "<strong>Stayline</strong><div style='opacity:.82;margin-top:4px'>The passkey window cannot open here. Use Microsoft Authenticator or another method.</div>";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Other method";
    btn.style.cssText = "flex:0 0 auto;white-space:nowrap;border:0;border-radius:8px;padding:8px 12px;background:#ececea;color:#0a0b0d;font-weight:600;cursor:pointer";
    btn.addEventListener("click", (e) => { e.preventDefault(); pickOther(); });
    el.appendChild(copy);
    el.appendChild(btn);
    (document.body || document.documentElement).appendChild(el);
  }

  function watch() {
    const text = document.body ? document.body.innerText : "";
    if (FIDO.test(text)) {
      banner();
      if (!window.__staylinePicked) {
        window.__staylinePicked = true;
        setTimeout(() => pickOther(), 7500);
      }
    }
  }

  new MutationObserver(watch).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
  else watch();
  setTimeout(watch, 400);
  setTimeout(watch, 1600);
  return true;
})();
`;

module.exports = { INJECT_AUTH_JS };
