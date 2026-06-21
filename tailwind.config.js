/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        bg: "#0a0a0a",
        panel: "#0f0f0f",
        border: "#1f1f1f",
        muted: "#6b7280",
        fg: "#e5e7eb",
        accent: "#bef264",
        red: "#f87171",
      },
    },
  },
  plugins: [],
};
