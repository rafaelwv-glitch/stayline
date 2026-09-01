"use strict";

const { powerSaveBlocker } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const STATUS_MAP = {
  Available: { availability: "Available", activity: "Available" },
  Busy: { availability: "Busy", activity: "Busy" },
  DoNotDisturb: { availability: "DoNotDisturb", activity: "DoNotDisturb" },
  BeRightBack: { availability: "BeRightBack", activity: "BeRightBack" },
  Away: { availability: "Away", activity: "Away" },
  Offline: { availability: "Offline", activity: "OffWork" },
};

const GRAPH = "https://graph.microsoft.com/v1.0";
const PRESENCE_HOSTS = [
  "https://graph.microsoft.com/*",
  "https://presence.teams.microsoft.com/*",
  "https://*.teams.microsoft.com/*",
  "https://*.office.com/*",
  "https://*.office365.com/*",
];

class PresenceLock {
  /**
   * @param {{
   *   session: Electron.Session,
   *   getContents: () => Electron.WebContents | null,
   *   getConfig: () => object,
   *   userData: string,
   *   accountId?: string,
   *   onLog?: (entry: object) => void,
   *   onIdentity?: (profile: object) => void,
   * }} opts
   */
  constructor(opts) {
    this.session = opts.session;
    this.getContents = opts.getContents;
    this.getConfig = opts.getConfig;
    this.userData = opts.userData;
    this.accountId = opts.accountId || "default";
    this.onLog = opts.onLog || (() => {});
    this.onIdentity = opts.onIdentity || (() => {});
    this.graphToken = null;
    this.skypeToken = null;
    this.userId = null;
    this.sessionId = `stayline-lock-${this.accountId}`;
    this.pingTimer = null;
    this.refreshTimer = null;
    this.blockerId = null;
    this.started = false;
    this.identified = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.captureTokens();
    this.armTimers();
    this.blockIdlePermission();
    this.holdPower();
    this.log("lock", "Presence lock started");
  }

  stop() {
    this.started = false;
    this.clearTimers();
    this.releasePower();
    this.log("lock", "Presence lock stopped");
  }

  setEnabled(enabled) {
    const cfg = this.getConfig();
    cfg.lockEnabled = enabled;
    if (enabled) {
      this.armTimers();
      this.holdPower();
      this.assertNow("lock armed");
    } else {
      this.clearTimers();
      this.releasePower();
    }
  }

  setStatus(status) {
    const cfg = this.getConfig();
    cfg.lockedStatus = status;
    this.assertNow(`status → ${status}`);
  }

  armTimers() {
    this.clearTimers();
    const cfg = this.getConfig();
    if (!cfg.lockEnabled) return;
    const pingMs = Math.max(15, Number(cfg.pingIntervalSec) || 45) * 1000;
    const refreshMs = Math.max(60, Number(cfg.presenceRefreshSec) || 240) * 1000;
    this.pingTimer = setInterval(() => this.pingActivity(), pingMs);
    this.refreshTimer = setInterval(() => this.assertNow("heartbeat"), refreshMs);
    setTimeout(() => this.assertNow("initial"), 4000);
  }

  clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.pingTimer = null;
    this.refreshTimer = null;
  }

  holdPower() {
    if (this.blockerId == null) {
      this.blockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
  }

  releasePower() {
    if (this.blockerId != null && powerSaveBlocker.isStarted(this.blockerId)) {
      powerSaveBlocker.stop(this.blockerId);
    }
    this.blockerId = null;
  }

  blockIdlePermission() {
    this.session.setPermissionRequestHandler((wc, permission, callback) => {
      if (permission === "idle-detection") {
        callback(false);
        return;
      }
      const allow = new Set([
        "notifications",
        "media",
        "display-capture",
        "mediaKeySystem",
        "clipboard-sanitized-write",
        "fullscreen",
        "pointerLock",
        "speaker-selection",
        "storage-access",
      ]);
      callback(allow.has(permission));
    });
    this.session.setPermissionCheckHandler((_wc, permission) => {
      if (permission === "idle-detection") return false;
      return true;
    });
  }

  captureTokens() {
    this.session.webRequest.onBeforeSendHeaders({ urls: PRESENCE_HOSTS }, (details, callback) => {
      const headers = details.requestHeaders || {};
      const auth = headers.Authorization || headers.authorization;
      if (auth && /graph\.microsoft\.com/i.test(details.url)) {
        const first = !this.graphToken;
        this.graphToken = auth;
        if (!this.userId) this.userId = parseOid(auth);
        if (first) this.identify();
      }
      if (auth && /presence\.teams\.microsoft\.com/i.test(details.url)) {
        this.skypeToken = auth;
      }
      const skype = headers["x-skypetoken"] || headers["X-Skypetoken"];
      if (skype) this.skypeToken = String(skype);
      persistTokens(this.userData, this.accountId, {
        graphToken: this.graphToken,
        skypeToken: this.skypeToken,
        userId: this.userId,
      });
      callback({ requestHeaders: headers });
    });
  }

  pingActivity() {
    if (!this.getConfig().lockEnabled) return;
    const wc = this.getContents();
    if (!wc || wc.isDestroyed()) return;
    try {
      wc.sendInputEvent({ type: "mouseMove", x: 8, y: 8, movementX: 0, movementY: 0 });
      wc.executeJavaScript(ACTIVITY_PING_JS, true).catch(() => {});
      this.log("ping", "Input keepalive");
    } catch (err) {
      this.log("ping", `Keepalive failed: ${err.message}`);
    }
  }

  async assertNow(reason) {
    const cfg = this.getConfig();
    if (!cfg.lockEnabled) return;
    const mapped = STATUS_MAP[cfg.lockedStatus] || STATUS_MAP.Available;
    const hours = Math.max(1, Number(cfg.preferredPresenceHours) || 8);
    const duration = `PT${hours}H`;

    this.pingActivity();
    this.injectVisibility();

    let graphOk = false;
    if (this.graphToken) {
      try {
        if (!this.userId) {
          this.userId = (await graphMe(this.graphToken)) || parseOid(this.graphToken);
        }
        if (this.userId) {
          const sessionRes = await graphPost(
            this.graphToken,
            `/users/${this.userId}/presence/setPresence`,
            {
              sessionId: this.sessionId,
              availability: mapped.availability,
              activity: mapped.activity,
              expirationDuration: "PT1H",
            },
          );
          const prefRes = await graphPost(
            this.graphToken,
            `/users/${this.userId}/presence/setUserPreferredPresence`,
            {
              availability: mapped.availability,
              activity: mapped.activity,
              expirationDuration: duration,
            },
          );
          graphOk = sessionRes.ok || prefRes.ok;
          this.log(
            "assert",
            `Graph ${graphOk ? "ok" : "fail"} · ${mapped.availability} · ${reason} · ${sessionRes.status}/${prefRes.status}`,
          );
        }
      } catch (err) {
        this.log("assert", `Graph error: ${err.message}`);
      }
    }

    if (!graphOk && this.skypeToken) {
      try {
        const ok = await forceAvailability(this.skypeToken, mapped.availability);
        this.log("assert", `Teams presence ${ok ? "ok" : "fail"} · ${mapped.availability} · ${reason}`);
      } catch (err) {
        this.log("assert", `Teams presence error: ${err.message}`);
      }
    }

    if (!this.graphToken && !this.skypeToken) {
      this.log("assert", `No token yet · keepalive only · ${reason}`);
    }
  }

  identify() {
    if (this.identified || !this.graphToken) return;
    this.identified = true;
    graphProfile(this.graphToken)
      .then((profile) => {
        if (!profile) {
          this.identified = false;
          return;
        }
        this.userId = profile.id || this.userId;
        this.onIdentity(profile);
        this.log("assert", `Signed in · ${profile.email || profile.displayName || profile.id}`);
      })
      .catch(() => {
        this.identified = false;
      });
  }

  injectVisibility() {
    const wc = this.getContents();
    if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScript(VISIBILITY_JS, true).catch(() => {});
  }

  log(kind, text) {
    this.onLog({ t: Date.now(), kind, text });
  }
}

function parseOid(token) {
  return parseClaims(token).oid || null;
}

function parseClaims(token) {
  try {
    const raw = String(token).replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(Buffer.from(raw.split(".")[1], "base64url").toString("utf8"));
    return {
      oid: payload.oid || payload.sub || null,
      tid: payload.tid || "",
      upn: payload.upn || payload.unique_name || payload.preferred_username || payload.email || "",
      name: payload.name || "",
    };
  } catch {
    return { oid: null, tid: "", upn: "", name: "" };
  }
}

async function graphMe(token) {
  const profile = await graphProfile(token);
  return profile?.id || null;
}

async function graphProfile(token) {
  const headers = { Authorization: normalizeAuth(token) };
  const claims = parseClaims(token);
  let displayName = claims.name;
  let email = claims.upn;
  let id = claims.oid;
  let tenant = "";

  try {
    const res = await fetch(`${GRAPH}/me?$select=id,displayName,mail,userPrincipalName`, { headers });
    if (res.ok) {
      const me = await res.json();
      id = me.id || id;
      displayName = me.displayName || displayName;
      email = me.mail || me.userPrincipalName || email;
    }
  } catch {
    /* keep JWT claims */
  }

  try {
    const res = await fetch(`${GRAPH}/organization?$select=id,displayName`, { headers });
    if (res.ok) {
      const org = await res.json();
      tenant = org.value?.[0]?.displayName || "";
    }
  } catch {
    /* optional */
  }

  if (!email && !id) return null;
  return {
    id,
    displayName,
    email,
    tenant,
    tid: claims.tid,
  };
}

async function graphPost(token, pathname, body) {
  const res = await fetch(`${GRAPH}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: normalizeAuth(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function forceAvailability(skypeToken, availability) {
  const res = await fetch("https://presence.teams.microsoft.com/v1/me/forceavailability/", {
    method: "PUT",
    headers: {
      Authorization: normalizeAuth(skypeToken),
      "Content-Type": "application/json",
      "X-Skypetoken": String(skypeToken).replace(/^Bearer\s+/i, ""),
    },
    body: JSON.stringify({ availability }),
  });
  return res.ok || res.status === 204;
}

function normalizeAuth(token) {
  const value = String(token);
  return value.toLowerCase().startsWith("bearer ") ? value : `Bearer ${value}`;
}

function persistTokens(userData, accountId, bag) {
  try {
    const file = path.join(userData, `session-meta-${accountId}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ userId: bag.userId, capturedAt: Date.now() }, null, 2),
    );
  } catch {
    /* ignore */
  }
}

const VISIBILITY_JS = `
(() => {
  try {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "wasDiscarded", { configurable: true, get: () => false });
  } catch {}
  try {
    if (window.__staylineVis) return true;
    window.__staylineVis = true;
    document.addEventListener("visibilitychange", (e) => {
      e.stopImmediatePropagation();
    }, true);
  } catch {}
  return true;
})();
`;

const ACTIVITY_PING_JS = `
(() => {
  const x = 12 + Math.random();
  const y = 12 + Math.random();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
  document.dispatchEvent(new MouseEvent("mousemove", opts));
  document.dispatchEvent(new MouseEvent("pointermove", opts));
  window.dispatchEvent(new Event("focus"));
  return true;
})();
`;

module.exports = { PresenceLock, STATUS_MAP };
