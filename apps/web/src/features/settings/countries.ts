export interface Country {
  name: string;
  dial: string; // includes leading +
  flag: string;
}

// A broad, scrollable list. Dial codes include the leading +.
export const COUNTRIES: Country[] = [
  { name: "Belgium", dial: "+32", flag: "🇧🇪" },
  { name: "Netherlands", dial: "+31", flag: "🇳🇱" },
  { name: "United States", dial: "+1", flag: "🇺🇸" },
  { name: "United Kingdom", dial: "+44", flag: "🇬🇧" },
  { name: "France", dial: "+33", flag: "🇫🇷" },
  { name: "Germany", dial: "+49", flag: "🇩🇪" },
  { name: "Spain", dial: "+34", flag: "🇪🇸" },
  { name: "Italy", dial: "+39", flag: "🇮🇹" },
  { name: "Ireland", dial: "+353", flag: "🇮🇪" },
  { name: "Portugal", dial: "+351", flag: "🇵🇹" },
  { name: "Luxembourg", dial: "+352", flag: "🇱🇺" },
  { name: "Switzerland", dial: "+41", flag: "🇨🇭" },
  { name: "Austria", dial: "+43", flag: "🇦🇹" },
  { name: "Denmark", dial: "+45", flag: "🇩🇰" },
  { name: "Sweden", dial: "+46", flag: "🇸🇪" },
  { name: "Norway", dial: "+47", flag: "🇳🇴" },
  { name: "Finland", dial: "+358", flag: "🇫🇮" },
  { name: "Poland", dial: "+48", flag: "🇵🇱" },
  { name: "Czechia", dial: "+420", flag: "🇨🇿" },
  { name: "Greece", dial: "+30", flag: "🇬🇷" },
  { name: "Romania", dial: "+40", flag: "🇷🇴" },
  { name: "Hungary", dial: "+36", flag: "🇭🇺" },
  { name: "Croatia", dial: "+385", flag: "🇭🇷" },
  { name: "Ukraine", dial: "+380", flag: "🇺🇦" },
  { name: "Canada", dial: "+1", flag: "🇨🇦" },
  { name: "Mexico", dial: "+52", flag: "🇲🇽" },
  { name: "Brazil", dial: "+55", flag: "🇧🇷" },
  { name: "Argentina", dial: "+54", flag: "🇦🇷" },
  { name: "Australia", dial: "+61", flag: "🇦🇺" },
  { name: "New Zealand", dial: "+64", flag: "🇳🇿" },
  { name: "Japan", dial: "+81", flag: "🇯🇵" },
  { name: "South Korea", dial: "+82", flag: "🇰🇷" },
  { name: "China", dial: "+86", flag: "🇨🇳" },
  { name: "India", dial: "+91", flag: "🇮🇳" },
  { name: "Singapore", dial: "+65", flag: "🇸🇬" },
  { name: "Hong Kong", dial: "+852", flag: "🇭🇰" },
  { name: "Indonesia", dial: "+62", flag: "🇮🇩" },
  { name: "Thailand", dial: "+66", flag: "🇹🇭" },
  { name: "Philippines", dial: "+63", flag: "🇵🇭" },
  { name: "Vietnam", dial: "+84", flag: "🇻🇳" },
  { name: "Turkey", dial: "+90", flag: "🇹🇷" },
  { name: "Israel", dial: "+972", flag: "🇮🇱" },
  { name: "United Arab Emirates", dial: "+971", flag: "🇦🇪" },
  { name: "Saudi Arabia", dial: "+966", flag: "🇸🇦" },
  { name: "South Africa", dial: "+27", flag: "🇿🇦" },
  { name: "Egypt", dial: "+20", flag: "🇪🇬" },
  { name: "Morocco", dial: "+212", flag: "🇲🇦" },
  { name: "Nigeria", dial: "+234", flag: "🇳🇬" },
  { name: "Kenya", dial: "+254", flag: "🇰🇪" },
];

/** Split an E.164 number into the best-matching dial code + national remainder. */
export function splitDial(e164: string): { dial: string; national: string } {
  const digits = e164.replace(/[^\d+]/g, "");
  // Longest dial code that prefixes the number wins.
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial));
  if (match) return { dial: match.dial, national: digits.slice(match.dial.length) };
  return { dial: COUNTRIES[0]!.dial, national: digits.replace(/^\+/, "") };
}
