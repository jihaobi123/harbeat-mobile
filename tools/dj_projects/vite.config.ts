import { fileURLToPath } from "node:url";

export default {
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: false,
  build: {
    rollupOptions: {
      input: fileURLToPath(new URL("preview.html", import.meta.url)),
    },
  },
};
