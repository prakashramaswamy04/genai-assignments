import { StorageService } from "../services/storage-service.js";

const storage = new StorageService();
const openWorkspace = async (view = "create") => {
  const url = chrome.runtime.getURL(`dashboard/dashboard.html#${view}`);
  await chrome.tabs.create({ url });
  window.close();
};

document.getElementById("openWorkspace").addEventListener("click", () => openWorkspace("create"));
document.getElementById("openSettings").addEventListener("click", () => openWorkspace("settings"));

storage.hasApiKey().then((hasKey) => {
  const state = document.getElementById("keyState");
  const indicator = document.createElement("i");
  if (hasKey) indicator.classList.add("ready");
  state.replaceChildren(indicator, document.createTextNode(hasKey ? " AI provider configured" : " Add an API key in Settings"));
}).catch(() => {
  document.getElementById("keyState").textContent = "Open settings to configure AI";
});
