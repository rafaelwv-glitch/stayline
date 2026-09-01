"use strict";

const { randomUUID } = require("node:crypto");

function createAccount(partial = {}) {
  const id = partial.id || randomUUID();
  return {
    id,
    label: partial.label || "Account",
    partition: partial.partition || `persist:stayline-${id}`,
    lockEnabled: partial.lockEnabled !== false,
    lockedStatus: partial.lockedStatus || "Available",
    email: partial.email || "",
    tenant: partial.tenant || "",
    userId: partial.userId || "",
    tid: partial.tid || "",
    labelCustom: Boolean(partial.labelCustom),
  };
}

function migrateAccounts(config) {
  const next = { ...config };
  if (!Array.isArray(next.accounts) || next.accounts.length === 0) {
    const first = createAccount({
      id: "default",
      label: "Account 1",
      partition: next.partition || "persist:stayline",
      lockEnabled: next.lockEnabled !== false,
      lockedStatus: next.lockedStatus || "Available",
    });
    next.accounts = [first];
    next.activeAccountId = first.id;
  } else {
    next.accounts = next.accounts.map((account) => createAccount(account));
  }

  if (!next.accounts.some((account) => account.id === next.activeAccountId)) {
    next.activeAccountId = next.accounts[0].id;
  }

  const active = next.accounts.find((account) => account.id === next.activeAccountId);
  next.lockEnabled = active.lockEnabled;
  next.lockedStatus = active.lockedStatus;
  next.partition = active.partition;
  return next;
}

function syncActiveAccount(config) {
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  const active = accounts.find((account) => account.id === config.activeAccountId) || accounts[0];
  if (!active) return config;
  active.lockEnabled = config.lockEnabled !== false;
  active.lockedStatus = config.lockedStatus || active.lockedStatus;
  return {
    ...config,
    partition: active.partition,
    accounts,
    activeAccountId: active.id,
  };
}

function accountMenuLabel(account) {
  if (account.email) return account.email;
  if (account.tenant) return account.tenant;
  return account.label || "Account";
}

function labelFromProfile(profile) {
  if (profile.tenant) return profile.tenant;
  if (profile.email && profile.email.includes("@")) {
    return profile.email.split("@")[1];
  }
  return profile.displayName || profile.email || "Account";
}

function applyIdentity(account, profile) {
  const next = { ...account };
  next.email = profile.email || next.email;
  next.tenant = profile.tenant || next.tenant;
  next.userId = profile.id || next.userId;
  next.tid = profile.tid || next.tid;
  if (!next.labelCustom) {
    next.label = labelFromProfile(profile);
  }
  return next;
}

function publicAccount(account) {
  return {
    id: account.id,
    label: account.label,
    email: account.email,
    tenant: account.tenant,
  };
}

module.exports = {
  createAccount,
  migrateAccounts,
  syncActiveAccount,
  accountMenuLabel,
  applyIdentity,
  publicAccount,
};
