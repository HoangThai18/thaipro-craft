import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

/**
 * Cấu hình chỉ dùng cho kiểm thử giao diện: thay hai module của Tauri bằng bản
 * giả lập để mở app trong trình duyệt và điều khiển bằng Playwright.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^@tauri-apps\/api\/core$/,
        replacement: resolve(__dirname, "src/test/tauriCoreMock.ts"),
      },
      {
        find: /^@tauri-apps\/plugin-dialog$/,
        replacement: resolve(__dirname, "src/test/tauriDialogMock.ts"),
      },
    ],
  },
  // Cho phép Vite phục vụ tệp media nằm ngoài thư mục dự án.
  server: {
    port: 5175,
    strictPort: true,
    fs: { allow: ["/"], strict: false },
  },
});