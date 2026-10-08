/**
 * Kho hiệu ứng của OpenCutCut.
 *
 * Tên và nhóm bám theo kho hiệu ứng của CapCut (3D Zoom, Retro, Film, Glow,
 * Mosaic, Pixelate, VHS, Kaleidoscope, Light leak, CRT, Shake, Flash…). Mỗi
 * hiệu ứng gắn với một chuỗi lệnh ffmpeg đã kiểm chứng chạy thật, nên xuất
 * video không bị lỗi.
 *
 * `loi` là mô tả ngắn hiệu ứng làm gì, hiển thị kèm trong bảng chọn.
 */
export type HieuUng = {
  id: string;
  /** Nhóm hiển thị trên đầu bảng chọn. */
  nhom: string;
  ten: string;
  loi?: string;
  /** Mảng màu xem trước, ghép thành nền CSS. */
  mau: string;
  /** Lệnh ffmpeg (không kèm nhãn đầu/cuối). */
  ffmpeg?: string;
  /**
   * Lệnh nâng bậc thêm, chỉ dùng khi người dùng bật "Mạnh".
   * `thuoc` cho biết có cần nâng bậc không.
   */
  ffmpegManh?: string;
};

/** Nhóm hiệu ứng, đúng thứ tự hiển thị. */
export const nhomHieuUng = [
  "Phổ biến",
  "Chuyển động",
  "Cổ điển",
  "Nghệ thuật",
  "Retro",
  "Biến dạng",
  "Ánh sáng",
] as const;

export const hieuUng: HieuUng[] = [
  // ----- Phổ biến -----
  {
    id: "zoom_vao",
    nhom: "Chuyển động",
    ten: "Zoom vào",
    loi: "Phóng to dần vào giữa khung",
    mau: "linear-gradient(135deg,#f59e0b,#ef4444)",
    ffmpeg:
      "scale=iw*'1+0.35*min(t/3,1)':ih*'1+0.35*min(t/3,1)':eval=frame,crop=iw/1.35:ih/1.35",
  },
  {
    id: "zoom_ra",
    nhom: "Chuyển động",
    ten: "Zoom ra",
    loi: "Thu nhỏ dần từ giữa",
    mau: "linear-gradient(135deg,#22d3ee,#3b82f6)",
    ffmpeg:
      "scale=iw*'(1.4-0.4*min(t/3,1))':ih*'(1.4-0.4*min(t/3,1))':eval=frame,crop=iw/1.4:ih/1.4",
  },
  {
    id: "zoom_3d_vao",
    nhom: "Chuyển động",
    ten: "3D Zoom",
    loi: "Có chiều sâu như quay phim",
    mau: "linear-gradient(135deg,#fb7185,#a855f7)",
    ffmpeg:
      "scale=iw*'1+0.5*min(t/3,1)':ih*'1+0.5*min(t/3,1)':eval=frame,crop=iw/1.5:ih/1.5",
  },
  {
    id: "lay",
    nhom: "Chuyển động",
    ten: "Lắc máy",
    loi: "Rung nhẹ như cầm tay quay",
    mau: "linear-gradient(135deg,#94a3b8,#475569)",
    ffmpeg:
      "crop=iw-16:ih-16:'8+4*sin(t*38)':'8+4*cos(t*31)',scale=iw:ih",
  },
  {
    id: "chop_an",
    nhom: "Chuyển động",
    ten: "Chớp sáng",
    loi: "Một vệt sáng trắng quét qua",
    mau: "linear-gradient(135deg,#fef9c3,#f8fafc)",
    ffmpeg:
      "eq=brightness='0.22*exp(-pow((mod(t\\,1.5)-0.4)*14\\,2))':eval=frame",
    ffmpegManh:
      "eq=brightness='0.38*exp(-pow((mod(t\\,1.2)-0.4)*12\\,2))':eval=frame",
  },
  {
    id: "pho_de",
    nhom: "Chuyển động",
    ten: "Phơi sáng",
    loi: "Tăng dần độ sáng",
    mau: "linear-gradient(135deg,#fffbeb,#fde68a)",
    ffmpeg: "eq=brightness='0.2*min(t/2\\,1)':eval=frame",
  },

  // ----- Cổ điển -----
  {
    id: "phim",
    nhom: "Cổ điển",
    ten: "Phim cũ",
    loi: "Màu nhạt và hạt nhiễu",
    mau: "linear-gradient(135deg,#d6b48a,#8b7355)",
    ffmpeg: "curves=all='0/0 0.4/0.45 0.75/0.85 1/0.95',eq=saturation=0.85",
    ffmpegManh: "curves=all='0/0 0.3/0.35 0.7/0.9 1/1',noise=alls=12:allf=t",
  },
  {
    id: "truyen_anh",
    nhom: "Cổ điển",
    ten: "Truyện ảnh",
    loi: "Giảm dần màu",
    mau: "linear-gradient(135deg,#9ca3af,#111827)",
    ffmpeg: "eq=saturation=0",
  },
  {
    id: "sepia",
    nhom: "Cổ điển",
    ten: "Sepia",
    loi: "Tông nâu cổ",
    mau: "linear-gradient(135deg,#d4a373,#8b5e3c)",
    ffmpeg: "colorchannelmixer=.39:.77:.19:0:.35:.69:.17:0:.27:.53:.13:0",
  },
  {
    id: "vhs",
    nhom: "Retro",
    ten: "VHS",
    loi: "Trôi màu và nhiễu dòng",
    mau: "linear-gradient(135deg,#22d3ee,#db2777)",
    ffmpeg: "chromashift=crh=3:cbh=-3:crv=2:cbv=-2,noise=alls=8:allf=t+u",
    ffmpegManh: "chromashift=crh=7:cbh=-7:crv=5:cbv=-5,noise=alls=18:allf=t+u",
  },
  {
    id: "retro_zoom",
    nhom: "Retro",
    ten: "Retro zoom",
    loi: "Zoom từng bước như video cũ",
    mau: "linear-gradient(135deg,#fbbf24,#f472b6)",
    ffmpeg:
      "scale=iw*'1.02+0.3*floor(min(t/0.7\\,4))/4':ih*'1.02+0.3*floor(min(t/0.7\\,4))/4':eval=frame,crop=iw/1.32:ih/1.32",
  },
  {
    id: "crt",
    nhom: "Retro",
    ten: "CRT",
    loi: "Màn hình cũ có sọc",
    mau: "linear-gradient(135deg,#4ade80,#065f46)",
    ffmpeg:
      "eq=saturation=1.15:contrast=1.1,vignette=angle=PI/4.5,noise=alls=6:allf=t",
  },
  {
    id: "loa_sieu",
    nhom: "Retro",
    ten: "Lóa sáng",
    loi: "Ánh sáng tràn từ mép",
    mau: "linear-gradient(135deg,#fef08a,#f97316)",
    ffmpeg: "eq=brightness=0.08:saturation=1.3,vignette=angle=PI/2.5",
  },

  // ----- Nghệ thuật -----
  {
    id: "neon",
    nhom: "Nghệ thuật",
    ten: "Neon",
    loi: "Màu mạnh và tương phản cao",
    mau: "linear-gradient(135deg,#a855f7,#06b6d4)",
    ffmpeg: "eq=saturation=1.6:contrast=1.2:gamma=1.05",
    ffmpegManh: "eq=saturation=2.2:contrast=1.35:gamma=1.1",
  },
  {
    id: "trieu_luong",
    nhom: "Nghệ thuật",
    ten: "Triệu lượng",
    loi: "Mềm và nhiều sắc",
    mau: "linear-gradient(135deg,#f9a8d4,#c4b5fd)",
    ffmpeg: "eq=saturation=1.25:gamma=1.12:brightness=0.04",
  },
  {
    id: "mo_man",
    nhom: "Nghệ thuật",
    ten: "Mơ man",
    loi: "Nhoè nhẹ và sáng",
    mau: "linear-gradient(135deg,#bae6fd,#e0e7ff)",
    ffmpeg: "gblur=sigma=2,eq=brightness=0.05:gamma=1.1",
  },
  {
    id: "doi_mau",
    nhom: "Nghệ thuật",
    ten: "Đổi màu",
    loi: "Đảo toàn bộ màu",
    mau: "linear-gradient(135deg,#00ffff,#ff00ff)",
    ffmpeg: "negate",
  },
  {
    id: "am_bao",
    nhom: "Nghệ thuật",
    ten: "Ám ảo",
    loi: "Tương phản rất mạnh",
    mau: "linear-gradient(135deg,#f8fafc,#0f172a)",
    ffmpeg: "format=gray,eq=contrast=1.7:brightness=-0.04",
  },
  {
    id: "am",
    nhom: "Phổ biến",
    ten: "Ấm",
    loi: "Ngả vàng",
    mau: "linear-gradient(135deg,#fb923c,#f59e0b)",
    ffmpeg: "colortemperature=temperature=6500",
  },
  {
    id: "lanh",
    nhom: "Phổ biến",
    ten: "Lạnh",
    loi: "Ngả xanh",
    mau: "linear-gradient(135deg,#38bdf8,#6366f1)",
    ffmpeg: "colortemperature=temperature=10000",
  },
  {
    id: "hoai_niem",
    nhom: "Phổ biến",
    ten: "Hoài niệm",
    loi: "Mờ và cũ kỹ",
    mau: "linear-gradient(135deg,#d6b48a,#8b7355)",
    ffmpeg: "curves=all='0/0 0.4/0.45 0.75/0.85 1/0.95',eq=contrast=1.05:saturation=0.9",
  },

  // ----- Biến dạng -----
  {
    id: "pixel",
    nhom: "Biến dạng",
    ten: "Pixel hoá",
    loi: "Vỡ thành ô vuông",
    mau: "linear-gradient(135deg,#f472b6,#7c3aed)",
    // Thu nhỏ rồi phóng lại bằng đúng hệ số để giữ kích thước gần như cũ; bước
    // cắt khung phía sau sẽ cắt phần dư cho vừa khung.
    ffmpeg: "scale=iw/12:ih/12,scale=iw*12:ih*12:flags=neighbor",
    ffmpegManh: "scale=iw/26:ih/26,scale=iw*26:ih*26:flags=neighbor",
  },
  {
    id: "khay_mo",
    nhom: "Biến dạng",
    ten: "Khảm",
    loi: "Chia thành ô nhỏ",
    mau: "linear-gradient(135deg,#34d399,#065f46)",
    ffmpeg:
      "crop=iw/3:ih/3,tile=3x3,scale=iw:ih",
  },
  {
    id: "guong",
    nhom: "Biến dạng",
    ten: "Gương",
    loi: "Lật trái phải",
    mau: "linear-gradient(135deg,#93c5fd,#1e3a8a)",
    ffmpeg: "hflip",
  },
  {
    id: "kaleido",
    nhom: "Biến dạng",
    ten: "Kaleidoscope",
    loi: "Lặp đối xứng như kính",
    mau: "linear-gradient(135deg,#c084fc,#312e81)",
    ffmpeg:
      "{IN}split[ka][kb];[kb]hflip[kc];[ka][kc]vstack,scale=iw/2:ih:flags=neighbor",
  },
  {
    id: "xoay",
    nhom: "Biến dạng",
    ten: "Xoay",
    loi: "Xoay từ từng khung",
    mau: "linear-gradient(135deg,#fdba74,#7c2d12)",
    ffmpeg: "rotate=t*0.15:c=none:fillcolor=black",
  },
  {
    id: "gia_pho",
    nhom: "Biến dạng",
    ten: "Cắt sóng",
    loi: "Mặt nước dao động",
    mau: "linear-gradient(135deg,#22d3ee,#0e7490)",
    // `geq` tính theo biến `T` (thời gian tính bằng giây), không phải `t`.
    ffmpeg:
      "geq=r='r(X\\,Y+8*sin(X/40+3*T))':g='g(X\\,Y+8*sin(X/40+3*T))':b='b(X\\,Y+8*sin(X/40+3*T))'",
  },

  // ----- Ánh sáng -----
  {
    id: "phat_sang",
    nhom: "Ánh sáng",
    ten: "Phát sáng",
    loi: "Viền sáng mềm",
    mau: "linear-gradient(135deg,#fde68a,#f59e0b)",
    ffmpeg:
      "{IN}split[hs1][hs2];[hs2]gblur=sigma=8[hs3];[hs1][hs3]blend=all_mode=screen:all_opacity=0.45",
    ffmpegManh:
      "{IN}split[hs1][hs2];[hs2]gblur=sigma=16[hs3];[hs1][hs3]blend=all_mode=screen:all_opacity=0.7",
  },
  {
    id: "lam_mo",
    nhom: "Ánh sáng",
    ten: "Làm mờ",
    loi: "Mềm toàn khung",
    mau: "linear-gradient(135deg,#bfdbfe,#60a5fa)",
    ffmpeg: "boxblur=3:1",
    ffmpegManh: "boxblur=8:2",
  },
  {
    id: "tang_net",
    nhom: "Ánh sáng",
    ten: "Tăng nét",
    loi: "Sắc nét lại chi tiết",
    mau: "linear-gradient(135deg,#4ade80,#065f46)",
    ffmpeg: "unsharp=5:5:1.1",
  },
  {
    id: "vien_toi",
    nhom: "Ánh sáng",
    ten: "Viền tối",
    loi: "Tối dần bốn góc",
    mau: "radial-gradient(circle,#9ca3af,#111827)",
    ffmpeg: "vignette=angle=PI/3.2",
  },
];

/** Tìm hiệu ứng theo id, trả về undefined nếu id không có trong kho. */
export const timHieuUng = (id: string): HieuUng | undefined =>
  hieuUng.find((h) => h.id === id);

/**
 * Ghép lệnh ffmpeg của hiệu ứng, đã gắn nhãn đầu/cuối.
 *
 * Hiệu ứng có thể gồm nhiều nhánh (`split`, `hstack`…) nên kết quả là một đoạn
 * filtergraph riêng, không phải một filter đơn lẻ.
 */
export const chuoiHieuUng = (id: string, manh: boolean): string | null => {
  const h = timHieuUng(id);
  if (!h) return null;
  const body = manh && h.ffmpegManh ? h.ffmpegManh : h.ffmpeg;
  return body ?? null;
};

/** Danh sách id hợp lệ, dùng để kiểm tra tệp dự án cũ. */
export const idHieuUngHopLe = (id: string): boolean => hieuUng.some((h) => h.id === id);