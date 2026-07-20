import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_OCEAN_BASE_PATH || "/",
  plugins: [react()],
});
