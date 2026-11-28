// PromptForge keeps background behavior intentionally small: the workspace is an
// extension page and performs AI requests only after an explicit user action.
chrome.runtime.onInstalled.addListener(() => {
  // Initialize versioned storage without overwriting existing user data.
  chrome.storage.local.get(["promptforge.schemaVersion"]).then((result) => {
    if (!result["promptforge.schemaVersion"]) {
      chrome.storage.local.set({ "promptforge.schemaVersion": 1 });
    }
  }).catch(() => {
    // Storage may be temporarily unavailable during installation or shutdown.
  });
});
