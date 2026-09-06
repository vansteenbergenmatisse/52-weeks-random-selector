/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm "fun love" theme — warm near-black panels, no blue anywhere.
        // Accent is a CSS variable so it can shift per logged-in person.
        panel: "#17110f",
        "panel-2": "#1e1613",
        "panel-3": "#271c18",
        header: "#120c0b",
        line: "#382a24",
        ink: "#f7ede9",
        muted: "#b39a90",
        faint: "#7c655c",
        accent: "var(--accent)",
        "accent-deep": "var(--accent-deep)",
        card: {
          red: "#e2495d",
          "red-2": "#b1313f",
          // "Movies" uses this key — recolored from blue to a warm berry.
          blue: "#c14a86",
          "blue-2": "#8c2f5f",
          purple: "#b04bb0",
          "purple-2": "#7a2f74",
          charcoal: "#2a201c",
          "charcoal-2": "#1a1310",
        },
        steel: "#9a8c86",
        "steel-dark": "#352a25",
      },
      fontFamily: {
        display: ['"Barlow Condensed"', '"Arial Narrow"', "system-ui", "sans-serif"],
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
      },
      boxShadow: {
        panel: "0 30px 80px -20px rgba(0,0,0,0.7)",
        frame: "0 0 0 2px rgba(0,0,0,0.5), inset 0 2px 6px rgba(255,255,255,0.15), inset 0 -6px 12px rgba(0,0,0,0.6)",
        card: "0 8px 18px -6px rgba(0,0,0,0.6)",
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "60%": { transform: "scale(1.04)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        glow: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(255,120,150,0)" },
          "50%": { boxShadow: "0 0 30px 6px rgba(255,120,150,0.4)" },
        },
        heartbeat: {
          "0%,100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.18)" },
        },
      },
      animation: {
        pop: "pop 350ms cubic-bezier(.2,.9,.3,1.2)",
        glow: "glow 1.4s ease-in-out",
        heartbeat: "heartbeat 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
