import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	server: {
		port: 3001,
		host: true,
		allowedHosts: ["e6c1-103-225-244-3.ngrok-free.app", "e6c1-103-225-244-3.ngrok-free.app/ws/"],
	},
});
