/** Test case categories the user can choose from, with guidance for the model. */
export const TEST_CATEGORIES = {
  'Functional': 'Valid, happy-path behaviour that verifies each acceptance criterion works as specified',
  'Negative': 'Invalid input, wrong actions or error conditions; the system must reject them gracefully with clear errors',
  'Boundary': 'Values at, just below and just above limits (min/max lengths, ranges, counts, dates, time-outs)',
  'Edge Case': 'Unusual but possible situations: empty/duplicate data, concurrency, interrupted flows, retries, unusual sequences',
  'UI': 'Visual layout, labels, messages, field states, navigation and responsiveness of the user interface',
  'Accessibility': 'Keyboard navigation, focus order, screen-reader labels/ARIA, colour contrast, WCAG 2.1 AA compliance',
  'Security': 'Authentication, authorisation/role checks, input injection (SQL/XSS), session handling, sensitive data exposure',
  'Usability': 'Ease of use, clarity of messages and instructions, number of steps, user guidance and feedback'
} as const

export type TestCategory = keyof typeof TEST_CATEGORIES
export const ALL_CATEGORIES = Object.keys(TEST_CATEGORIES) as TestCategory[]
