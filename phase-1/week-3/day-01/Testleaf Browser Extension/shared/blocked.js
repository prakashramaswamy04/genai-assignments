// Pages Chrome does not let extensions script, with the message the panel shows.

const SYSTEM = /^(chrome|chrome-extension|chrome-search|chrome-untrusted|devtools|edge|about|view-source):/i;
const WEB_STORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i;

/** Why `url` cannot be recorded, or null when it can. */
export function blockedPageMessage(url) {
  if (!url) return "This tab has no web page to record. Open the page you want to test.";
  if (SYSTEM.test(url)) return "Chrome pages (chrome://, settings, new tab) can't be recorded. Open the web page you want to test.";
  if (WEB_STORE.test(url)) return "Chrome blocks extensions on the Chrome Web Store, so this page can't be recorded.";
  if (/^file:/i.test(url)) return "Local files (file://) can't be recorded. Serve the page over http or https instead.";
  if (!/^https?:/i.test(url)) return "Only http and https pages can be recorded.";
  return null;
}
