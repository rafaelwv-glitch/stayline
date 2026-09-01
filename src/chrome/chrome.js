const lockEl = document.getElementById("lock");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

function applyState(state) {
  if (!state) return;
  lockEl.checked = Boolean(state.lockEnabled);
  if (state.lockedStatus) statusEl.value = state.lockedStatus;
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
document.getElementById("back").addEventListener("click", () => window.stayline.back());
document.getElementById("forward").addEventListener("click", () => window.stayline.forward());
document.getElementById("reload").addEventListener("click", () => window.stayline.reload());
