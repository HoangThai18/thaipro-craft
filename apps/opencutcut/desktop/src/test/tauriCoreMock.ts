/**
 * Bản giả lập các API của Tauri để chạy giao diện trong trình duyệt.
 * Chỉ dùng cho kiểm thử tự động, thông qua `vite.config.test.ts`.
 */

type InvokeHandler = (args: Record<string, any>) => unknown;

// Kho tệp giả cho kiểm thử lưu/mở dự án. Dùng `localStorage` để nội dung còn
// sống sau khi tải lại trang, nhờ vậy kiểm thử được cả vòng tự lưu rồi khôi phục.
const KHO = "opencutcut_mock_files";

const docTatCa = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(KHO) ?? "{}") ?? {};
  } catch {
    return {};
  }
};

export const datTepGia = (path: string, data: string) => {
  const kho = docTatCa();
  kho[path] = data;
  localStorage.setItem(KHO, JSON.stringify(kho));
};

export const xoaTepGia = () => localStorage.removeItem(KHO);

const handlers: Record<string, InvokeHandler> = {
  probe_media: (args) => (String(args.path).match(/\.(png|jpe?g|webp)$/i) ? 0 : 8),
  audio_waveform: (args) => {
    const buckets = Number(args.buckets ?? 40);
    return Array.from({ length: buckets }, (_, i) =>
      Math.abs(Math.sin(i / 3)) * (0.4 + (i % 5) * 0.1)
    );
  },
  detect_beats: () => [0, 0.5, 1, 1.5, 2, 2.5],
  // Clip trong thư viện thử đều là video tối, nên chỉ số trả về giống hệt
  // trường hợp ffmpeg đo được trên clip thật đó.
  do_mau_trung_binh: () => [0.28, 0.35, 0.3],
  // Dải thumbnail thật do ffmpeg tạo; ở trình duyệt chỉ cần một tệp tồn tại.
  clip_thumbnails: (args) =>
    `/private/var/folders/n0/wwsf8585587_32mzjfhsmv2w0000gn/T/opencode/occmedia/${
      String(args.path).endsWith(".png") ? "photo1.png" : "strip.png"
    }`,
  save_overlay_image: (args) => `/tmp/opencutcut_${args.name}.png`,
  save_project: (args) => {
    datTepGia(args.path, args.data);
    return args.path;
  },
  load_project: (args) => docTatCa()[args.path] ?? null,
  draft_path: () => "/tmp/opencutcut_ban_nhap.json",
  recent_projects: () => docTatCa()["__recent"] ? JSON.parse(docTatCa()["__recent"]) : [],
  recent_push: (args) => {
    const ds = (docTatCa()["__recent"] ? JSON.parse(docTatCa()["__recent"]) : []).filter(
      (p: { path: string }) => p.path !== args.path
    );
    ds.unshift({ path: args.path, ten: args.ten });
    datTepGia("__recent", JSON.stringify(ds.slice(0, 10)));
    return ds.slice(0, 10);
  },
  recent_remove: (args) => {
    const ds = (docTatCa()["__recent"] ? JSON.parse(docTatCa()["__recent"]) : []).filter(
      (p: { path: string }) => p.path !== args.path
    );
    datTepGia("__recent", JSON.stringify(ds));
    return ds;
  },
  export_video: (args) => `Xuất thành công: ${args.req.output}`,
};

export const invoke = async <T>(cmd: string, args: Record<string, any> = {}): Promise<T> => {
  const handler = handlers[cmd];
  if (!handler) throw new Error(`Lệnh chưa giả lập: ${cmd}`);
  return handler(args) as T;
};

/**
 * Trong app thật `convertFileSrc` đổi đường dẫn thành URL giao thức asset của
 * Tauri. Ở đây dùng `/@fs/` của Vite để trình duyệt tải được tệp thật.
 */
export const convertFileSrc = (path: string) => `/@fs${path}`;