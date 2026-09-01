const lockEl = document.getElementById("lock");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const accountEl = document.getElementById("account");

function accountLabel(account) {
  return account.email || account.tenant || account.label || "Account";
}

function renderAccounts(state) {
  if (!state?.accounts) return;
  const previous = accountEl.value;
  accountEl.innerHTML = "";
  for (const account of state.accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = accountLabel(account);
    accountEl.appendChild(option);
  }
  accountEl.value = state.activeAccountId || previous || state.accounts[0]?.id || "";
}

function applyState(state) {
  if (!state) return;
  lockEl.checked = Boolean(state.lockEnabled);
  if (state.lockedStatus) statusEl.value = state.lockedStatus;
  if (state.version) {
    const ver = document.getElementById("ver");
    if (ver) ver.textContent = state.version;
  }
  renderAccounts(state);
}

window.stayline.getState().then(applyState);
window.stayline.onState(applyState);
window.stayline.onLog((entry) => {
  if (entry && entry.text) logEl.textContent = entry.text;
});

lockEl.addEventListener("change", () => {
  window.stayline.setLock(lockEl.checked);
});
statusEl.addEventListener("change", () => {
  window.stayline.setStatus(statusEl.value);
});
accountEl.addEventListener("change", () => {
  if (accountEl.value) window.stayline.switchAccount(accountEl.value);
});
document.getElementById("add-account").addEventListener("click", () => {
  window.stayline.addAccount();
});
document.getElementById("back").addEventListener("click", () => window.stayline.back());
document.getElementById("forward").addEventListener("click", () => window.stayline.forward());
document.getElementById("reload").addEventListener("click", () => window.stayline.reload());
