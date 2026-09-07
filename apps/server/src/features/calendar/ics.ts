/** Minimal, dependency-free iCalendar (.ics) builder for a single event. */

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Format a Date as a UTC iCal timestamp: YYYYMMDDTHHMMSSZ. */
function icsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line to the RFC 5545 75-octet limit: split on UTF-8 byte
 * boundaries (never mid-multibyte-sequence) and continue with CRLF + one space.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  // First line takes 75 octets; continuation lines lose one to the leading space.
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte sequence: back up while on a UTF-8 continuation byte.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return out.join("\r\n ");
}

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  title: string;
  description?: string | null;
  location?: string | null;
  organizerEmail: string;
  attendeeEmails: string[];
}

/**
 * Build an "Add to Google Calendar" template link for a single event. Keyless —
 * opening it prefills Google Calendar's new-event form, so a partner adds the
 * pick to their own calendar with one tap, no email provider needed. Reuses the
 * same compact-UTC stamps as the .ics so both surfaces agree on the time.
 */
export function googleCalendarUrl(ev: {
  title: string;
  start: Date;
  end: Date;
  description?: string | null;
  location?: string | null;
}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${icsUtc(ev.start)}/${icsUtc(ev.end)}`,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIcs(ev: IcsEvent): string {
  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Our 52//Couples Roulette//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(ev.start)}`,
    `DTEND:${icsUtc(ev.end)}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.description ? `DESCRIPTION:${esc(ev.description)}` : null,
    ev.location ? `LOCATION:${esc(ev.location)}` : null,
    `ORGANIZER;CN=Our 52:mailto:${ev.organizerEmail}`,
    ...ev.attendeeEmails.map(
      (e) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${e}`,
    ),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => Boolean(l));
  return lines.map(fold).join("\r\n");
}
