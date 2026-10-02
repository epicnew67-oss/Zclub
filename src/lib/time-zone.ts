/** Convert a calendar/wall-clock minute in an IANA time zone to one UTC instant.
 * No match means a spring-forward gap; two matches means a fall-back overlap.
 */
export function zonedWallTimeToUtc(local: string, timeZone: string): { iso: string } | { error: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return { error: "Pick a valid date and time." };
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  const probe = new Date(wallUtc);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day || hour > 23 || minute > 59) {
    return { error: "Pick a valid date and time." };
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    return { error: "Pick a valid time zone in your account settings." };
  }
  const matches: number[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = wallUtc + offset * 60_000;
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    if (Number(parts.year) === year && Number(parts.month) === month && Number(parts.day) === day && Number(parts.hour) === hour && Number(parts.minute) === minute) {
      matches.push(instant);
    }
  }
  if (matches.length === 0) return { error: "That time does not exist because the clocks move forward. Pick another time." };
  if (matches.length > 1) return { error: "That time occurs twice because the clocks move back. Pick another time." };
  return { iso: new Date(matches[0]).toISOString() };
}
