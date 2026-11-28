// Manual test cases ticked for automation (NaviCase selectedIds). Shared by the
// Results tab, which shows the checkboxes, and the Automation tab.

const ids = new Set();
const listeners = new Set();
let cases = [];

const notify = () => listeners.forEach((fn) => fn());

export const selection = {
  has: (id) => ids.has(id),
  get size() {
    return ids.size;
  },
  /** The ticked cases from the current result, in result order. */
  selectedCases: () => cases.filter((tc) => ids.has(tc.id)),
  set(id, on) {
    on ? ids.add(id) : ids.delete(id);
    notify();
  },
  setMany(list, on) {
    for (const id of list) on ? ids.add(id) : ids.delete(id);
    notify();
  },
  /** A new result clears the selection; re-rendering the same one keeps it. */
  useCases(next) {
    cases = next || [];
    const known = new Set(cases.map((tc) => tc.id));
    for (const id of ids) if (!known.has(id)) ids.delete(id);
    notify();
  },
  clear() {
    ids.clear();
    notify();
  },
  subscribe: (fn) => listeners.add(fn),
};
