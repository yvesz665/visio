import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefcf5",
          100: "#d6f7e4",
          200: "#b0edcc",
          300: "#7bdcab",
          400: "#43c184",
          500: "#22a468",
          600: "#158454",
          700: "#126945",
          800: "#125438",
          900: "#10452f",
        },
      },
    },
  },
  plugins: [],
};
export default config;
