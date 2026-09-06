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
  ].filter(Boolean);
  return lines.join("\r\n");
}
