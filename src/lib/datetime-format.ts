/**
 * Locale-independent AM/PM: Node's ICU renders "pm" lowercase, browsers
 * usually "PM" — force uppercase so every surface matches.
 */
export function upperMeridiem(value: string): string {
  return value.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}
