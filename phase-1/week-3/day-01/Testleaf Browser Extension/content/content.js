// Ledge-3.0 content script: records user actions and builds a page snapshot.
// Runs in every frame (all_frames). Each iframe learns its <iframe> locator path
// from its parent via postMessage, and shadow roots (open and closed) are hooked
// as the user interacts with them, so actions inside iframes and web components
// are recorded with locators automation scripts can follow.
// Classic script, injected both declaratively and on demand: guard double init.

(() => {
  if (window.__ledgeLoaded) return;
  window.__ledgeLoaded = true;

  const KEYS = { recording: "fqaRecording", settings: "fqaSettings" };
  const EVENT_MSG = "fqa:event";
  const SENSITIVE = /pass(word)?|passcode|secret|token|otp|one.?time|verification|auth|api.?key|cvv|cvc|security.?code|card|pin|session|ssn|tax.?id|bank.?account|routing.?number|private.?key|\bcode\b/i;

  const isTop = window === window.top;
  let recording = false;
  let maskValues = false;

  chrome.storage.local.get([KEYS.recording, KEYS.settings]).then((s) => {
    recording = Boolean(s[KEYS.recording]?.active);
    maskValues = Boolean(s[KEYS.settings]?.maskValues);
    renderBadge();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[KEYS.recording]) {
      recording = Boolean(changes[KEYS.recording].newValue?.active);
      renderBadge();
    }
    if (changes[KEYS.settings]) maskValues = Boolean(changes[KEYS.settings].newValue?.maskValues);
  });

  // ---------------------------------------------------------------------------
  // Shadow DOM
  // ---------------------------------------------------------------------------

  /** An element's shadow root, including closed ones (extension-only API). */
  function shadowRootOf(el) {
    try {
      return (chrome.dom?.openOrClosedShadowRoot ? chrome.dom.openOrClosedShadowRoot(el) : el.shadowRoot) || null;
    } catch {
      return el.shadowRoot || null;
    }
  }

  /** This frame's document plus every shadow root nested in it, outermost first. */
  function allRoots() {
    const roots = [];
    const visit = (root) => {
      roots.push(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const sr = shadowRootOf(n);
        if (sr) visit(sr);
      }
    };
    visit(document);
    return roots;
  }

  const deepQueryAll = (selector, roots = allRoots()) => roots.flatMap((r) => [...r.querySelectorAll(selector)]);

  /** Shadow hosts between the frame's document and `el`, outermost first; undefined in light DOM. */
  function shadowPathOf(el) {
    const hops = [];
    for (let root = el.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) {
      hops.unshift(root.mode === "closed" ? { host: cssPath(root.host), closed: true } : { host: cssPath(root.host) });
    }
    return hops.length ? hops : undefined;
  }

  // ---------------------------------------------------------------------------
  // Frames: each iframe asks its parent which <iframe> element hosts it
  // ---------------------------------------------------------------------------

  const FRAME_MSG = "__ledge";
  let framePath = isTop ? [] : null;
  let resolveFramePath;
  const framePathReady = isTop ? Promise.resolve([]) : new Promise((r) => (resolveFramePath = r));

  if (!isTop) {
    const nonce = Math.random().toString(36).slice(2);
    // The parent's content script may load after ours, so ask a few times.
    const hello = () => !framePath && window.parent.postMessage({ [FRAME_MSG]: "hello", nonce }, "*");
    [0, 300, 1000, 3000, 8000].forEach((ms) => setTimeout(hello, ms));
    window.addEventListener("message", (e) => {
      const d = e.data;
      if (e.source !== window.parent || d?.[FRAME_MSG] !== "path" || d.nonce !== nonce || framePath) return;
      framePath = Array.isArray(d.path) ? d.path : [];
      resolveFramePath(framePath);
    });
  }

  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (d?.[FRAME_MSG] !== "hello" || !e.source) return;
    const iframe = deepQueryAll("iframe, frame").find((f) => f.contentWindow === e.source);
    if (!iframe) return;
    const hop = {
      selector: cssPath(iframe),
      id: iframe.id || undefined,
      name: iframe.getAttribute("name") || undefined,
      title: iframe.getAttribute("title") || undefined,
      src: clean(iframe.getAttribute("src"), 150) || undefined,
      shadowPath: shadowPathOf(iframe),
    };
    const parentPath = await framePathReady;
    e.source.postMessage({ [FRAME_MSG]: "path", nonce: d.nonce, path: [...parentPath, hop] }, "*");
  });

  /** This frame's iframe path, or a marker when the parent never answered (e.g. it cannot be scripted). */
  async function currentFramePath() {
    if (isTop) return undefined;
    const path = await Promise.race([framePathReady, new Promise((r) => setTimeout(() => r(null), 1500))]);
    return path ?? [{ src: location.href, unresolved: true }];
  }

  // ---------------------------------------------------------------------------
  // Element description
  // ---------------------------------------------------------------------------

  function clean(s, n = 80) {
    return (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  }

  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "checkbox" || t === "radio") return t;
      if (t === "range") return "slider";
      return "textbox";
    }
    return null;
  }

  /** Label text without the text of controls nested inside it (e.g. a <select>'s options). */
  function labelText(label) {
    const copy = label.cloneNode(true);
    copy.querySelectorAll("input, select, textarea, button").forEach((c) => c.remove());
    return clean(copy.textContent);
  }

  function labelFor(el) {
    if (el.labels?.length) return labelText(el.labels[0]);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      // Ids resolve within the element's own (shadow) root.
      const root = el.getRootNode();
      const scope = typeof root.getElementById === "function" ? root : document;
      const text = labelledBy.split(/\s+/).map((id) => scope.getElementById(id)?.innerText).filter(Boolean).join(" ");
      if (text) return clean(text);
    }
    return "";
  }

  /** CSS selector for `el`, relative to its own document or shadow root. */
  function cssPath(el) {
    if (el.id && !/\d{3,}/.test(el.id)) return `#${CSS.escape(el.id)}`;
    for (const attr of ["data-testid", "data-test", "data-cy", "name", "aria-label"]) {
      const v = el.getAttribute(attr);
      if (v) return `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(v)}"]`;
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node.id) {
        parts[0] = `#${CSS.escape(node.id)}`;
        break;
      }
      node = parent;
    }
    return parts.join(" > ");
  }

  function describe(el) {
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || implicitRole(el),
      id: el.id || undefined,
      name: el.getAttribute("name") || undefined,
      inputType: el.tagName === "INPUT" ? (el.type || "text").toLowerCase() : undefined,
      label: labelFor(el) || undefined,
      ariaLabel: el.getAttribute("aria-label") || undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      text: clean(el.innerText || el.value || el.getAttribute("title") || el.getAttribute("alt"), 80) || undefined,
      selector: cssPath(el),
      shadowPath: shadowPathOf(el),
    };
  }

  const INTERACTIVE = "a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[onclick]";
  const FIELD = "input:not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), select, textarea";

  async function send(event) {
    if (!recording) return;
    const full = { ...event, url: location.href, ts: Date.now() };
    const frame = await currentFramePath();
    if (frame) full.frame = frame;
    chrome.runtime.sendMessage({ type: EVENT_MSG, event: full }).catch(() => {});
  }

  /** Sensitive fields are always hidden; "Mask typed values" hides the rest. */
  function valueOf(el) {
    if (el.type === "password" || SENSITIVE.test(el.name || el.id || "")) return "••••••";
    if (maskValues) return "<masked>";
    return clean(el.value, 200);
  }

  // ---------------------------------------------------------------------------
  // Listeners (capture phase so app handlers cannot swallow them)
  //
  // `change` and `submit` do not cross shadow boundaries, and a listener on the
  // document cannot see inside closed shadow roots. So every shadow root the
  // user touches gets the same listeners. Roots are found from the composed
  // path of focus/pointer/key events, which always happen before a change or
  // submit inside that root. `handled` stops one event being recorded twice.
  // ---------------------------------------------------------------------------

  const hooked = new WeakSet();
  const handled = new WeakSet();

  function listen(root) {
    root.addEventListener("click", onClick, true);
    root.addEventListener("change", onChange, true);
    root.addEventListener("submit", onSubmit, true);
    root.addEventListener("keydown", onKeydown, true);
    for (const type of ["focusin", "pointerdown", "input"]) root.addEventListener(type, hookShadowRoots, true);
  }

  function hookShadowRoots(e) {
    const path = e.composedPath();
    for (const node of path) {
      if (node instanceof ShadowRoot && !hooked.has(node)) {
        hooked.add(node);
        listen(node);
      }
    }
    // A closed root is hidden from this listener: the event appears to target its host.
    const closed = path[0] instanceof Element ? shadowRootOf(path[0]) : null;
    if (closed?.mode === "closed" && !hooked.has(closed)) {
      hooked.add(closed);
      listen(closed);
    }
  }

  /** Run `record(path)` once per event, at the listener that can see the real target. */
  function handle(e, record) {
    hookShadowRoots(e);
    if (handled.has(e)) return;
    const path = e.composedPath();
    const run = () => {
      if (handled.has(e)) return;
      handled.add(e);
      record(path);
    };
    // The target is a host with a closed root: its own listener (inner, later in
    // the same dispatch) sees the real element. Fall back to the host if it doesn't.
    if (path[0] instanceof Element && shadowRootOf(path[0])?.mode === "closed") setTimeout(run, 0);
    else run();
  }

  function onClick(e) {
    handle(e, (path) => {
      if (badgeHost && path.includes(badgeHost)) return;
      const el = path.find((n) => n instanceof Element && n.matches(INTERACTIVE));
      // Checkbox/radio/select/text fields are reported via "change" instead.
      if (!el || el.matches(FIELD)) return;
      send({ type: "click", target: describe(el) });
    });
  }

  function onChange(e) {
    handle(e, (path) => {
      const el = path[0];
      if (!(el instanceof HTMLElement)) return;
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        send({ type: "check", checked: el.checked, target: describe(el) });
      } else if (el instanceof HTMLSelectElement) {
        send({ type: "select", value: clean(el.selectedOptions[0]?.text || el.value), target: describe(el) });
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        send({ type: "change", value: valueOf(el), target: describe(el) });
      }
    });
  }

  function onSubmit(e) {
    handle(e, (path) => {
      if (path[0] instanceof HTMLFormElement) send({ type: "submit", target: describe(path[0]) });
    });
  }

  function onKeydown(e) {
    if (e.key !== "Enter" && e.key !== "Escape") return hookShadowRoots(e);
    handle(e, (path) => {
      const el = path[0];
      if (el instanceof HTMLElement && el.matches("input, textarea, [contenteditable]")) {
        send({ type: "keydown", key: e.key, target: describe(el) });
      }
    });
  }

  listen(document);

  // ---------------------------------------------------------------------------
  // Page snapshot for the generator prompt (this frame only; the service worker
  // collects one per frame and nests iframe snapshots under the top page)
  // ---------------------------------------------------------------------------

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function snapshot() {
    const roots = allRoots();
    const q = (selector) => deepQueryAll(selector, roots).filter(visible);
    const isField = (f) => f.type !== "hidden" && visible(f);

    const field = (f) => ({
      label: labelFor(f) || f.getAttribute("aria-label") || f.placeholder || f.name || f.id || undefined,
      type: f.tagName === "INPUT" ? f.type : f.tagName.toLowerCase(),
      id: f.id || undefined,
      name: f.name || undefined,
      placeholder: f.placeholder || undefined,
      selector: cssPath(f),
      shadowPath: shadowPathOf(f),
      required: f.required || f.getAttribute("aria-required") === "true" || undefined,
      minLength: f.minLength > 0 ? f.minLength : undefined,
      maxLength: f.maxLength > 0 ? f.maxLength : undefined,
      min: f.min || undefined,
      max: f.max || undefined,
      pattern: f.pattern || undefined,
      options: f.tagName === "SELECT" ? [...f.options].slice(0, 15).map((o) => clean(o.text, 40)) : undefined,
    });

    const forms = q("form").slice(0, 8).map((form) => ({
      name: form.getAttribute("name") || form.id || form.getAttribute("aria-label") || undefined,
      method: (form.method || "get").toUpperCase(),
      fields: [...form.querySelectorAll("input, select, textarea")].filter(isField).slice(0, 40).map(field),
    }));
    // Fields that belong to no form (common in SPAs and web components).
    const looseFields = deepQueryAll("input, select, textarea", roots).filter((f) => isField(f) && !f.form).slice(0, 40).map(field);

    // Buttons keep their id/selector so automation scripts can target them without guessing.
    const buttons = new Map();
    for (const b of deepQueryAll("button, [role=button], input[type=submit], input[type=button]", roots)) {
      const text = clean(b.innerText || b.value || b.getAttribute("aria-label"), 50);
      if (!text || buttons.has(text) || !visible(b)) continue;
      buttons.set(text, { text, id: b.id || undefined, selector: cssPath(b), shadowPath: shadowPathOf(b) });
      if (buttons.size >= 40) break;
    }

    return {
      url: location.href,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || undefined,
      headings: q("h1, h2, h3").slice(0, 20).map((h) => `${h.tagName}: ${clean(h.innerText)}`),
      forms,
      fields: looseFields.length ? looseFields : undefined,
      buttons: [...buttons.values()],
      links: [...new Set(q("a[href]").map((a) => clean(a.innerText || a.getAttribute("aria-label"), 50)).filter(Boolean))].slice(0, 40),
      alerts: q("[role=alert], .error, .alert").slice(0, 5).map((a) => clean(a.innerText, 120)).filter(Boolean),
    };
  }

  // Called by the service worker through chrome.scripting.executeScript in every frame.
  window.__ledgeSnapshot = async () => {
    const snap = snapshot();
    const frame = await currentFramePath();
    return frame ? { framePath: frame, ...snap } : snap;
  };

  // ---------------------------------------------------------------------------
  // In-page "Ledge-3.0 recording" badge (top frame only; a closed shadow root
  // keeps page styles out). Built with DOM calls, no innerHTML.
  // ---------------------------------------------------------------------------

  const BADGE_CSS = `
    .b{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:8px;
       padding:7px 13px 7px 10px;border-radius:999px;background:#0F172A;color:#fff;
       font:600 12px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.02em;
       box-shadow:0 6px 20px rgba(15,23,42,.35);border:1px solid #10B981;pointer-events:none}
    .d{width:9px;height:9px;border-radius:50%;background:#EF4444;animation:p 1.6s infinite}
    @keyframes p{0%{box-shadow:0 0 0 0 rgba(239,68,68,.75)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
    @media (prefers-reduced-motion:reduce){.d{animation:none}}`;

  let badgeHost = null;
  function renderBadge() {
    if (!isTop) return;
    if (!recording) {
      badgeHost?.remove();
      badgeHost = null;
      return;
    }
    if (badgeHost || !document.body) return;
    badgeHost = document.createElement("div");
    badgeHost.id = "ledge-badge-host";
    const root = badgeHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = BADGE_CSS;
    const pill = document.createElement("div");
    pill.className = "b";
    pill.setAttribute("role", "status");
    const dot = document.createElement("span");
    dot.className = "d";
    pill.append(dot, "Ledge-3.0 · recording");
    root.append(style, pill);
    document.body.appendChild(badgeHost);
  }
})();
