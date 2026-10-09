/**
 * Thư viện nhãn dán (sticker).
 *
 * Tách riêng khỏi `App.tsx` để danh sách và phần lọc theo nhóm kiểm thử được
 * bằng số thuần. Mỗi nhãn là một ký tự nên không cần tải hình từ đâu: đủ dùng
 * ngoại tuyến và không phình thêm bản cài.
 */

/** Một nhãn dán trong thư viện. */
export type Nhan = {
  /** Ký tự hiển thị. */
  kyTu: string;
  /** Tên dùng để tìm kiếm, không hiển thị. */
  ten: string;
};

/** Các nhóm nhãn, đúng thứ tự hiển thị. */
export const NHOM_NHAN = [
  "Phổ biến",
  "Cảm xúc",
  "Cười lớn",
  "Mạng xã hội",
  "Kỷ niệm",
  "Mũi tên",
  "Hình học",
  "Trang trí",
] as const;

export type NhomNhan = (typeof NHOM_NHAN)[number];

/** Toàn bộ thư viện, mỗi nhóm một mảng đúng thứ tự hiển thị. */
export const THU_VIEN_NHAN: Record<NhomNhan, Nhan[]> = {
  "Phổ biến": [
    { kyTu: "⭐", ten: "sao vang sao ngoi" },
    { kyTu: "❤️", ten: "tim yeu thuong" },
    { kyTu: "🔥", ten: "lua chay nong" },
    { kyTu: "👍", ten: "gio ngon ok" },
    { kyTu: "✨", ten: "lap lanh dep" },
    { kyTu: "💯", ten: "tram diem chinh xac" },
    { kyTu: "🎉", ten: "tieng no chuc mung" },
    { kyTu: "🎬", ten: "phim quay" },
    { kyTu: "📍", ten: "dia diem dinh vi" },
    { kyTu: "🌈", ten: "cau vong" },
    { kyTu: "🚀", ten: "ten lua bay" },
    { kyTu: "⚡", ten: "set danh nhanh" },
    { kyTu: "💪", ten: "khoe manh co bap" },
    { kyTu: "🍀", ten: "clover may man" },
    { kyTu: "🎁", ten: "qua tang" },
    { kyTu: "📸", ten: "may anh chup" },
  ],
  "Cảm xúc": [
    { kyTu: "😀", ten: "cuoi vui" },
    { kyTu: "😍", ten: "thuong yeu khao khat" },
    { kyTu: "🤔", ten: "suy nghi thac mac" },
    { kyTu: "😴", ten: "ngu met buon ngu" },
    { kyTu: "😢", ten: "buon khoc" },
    { kyTu: "😡", ten: "tuc gian gian du" },
    { kyTu: "😮", ten: "ngac nhien bat ngo" },
    { kyTu: "🤯", ten: "dau kinh khung" },
    { kyTu: "🥳", ten: "vui suong" },
    { kyTu: "😎", ten: "ngau mat kinh" },
    { kyTu: "🤗", ten: "om hon" },
    { kyTu: "🙄", ten: "mat nghieng" },
    { kyTu: "😳", ten: "hoang hot so" },
    { kyTu: "🤩", ten: "ngoi sao mieu" },
    { kyTu: "😇", ten: "thien than" },
    { kyTu: "😭", ten: "khoc lon" },
  ],
  "Cười lớn": [
    { kyTu: "😂", ten: "cuoi nuoc mat" },
    { kyTu: "🤣", ten: "cuoi la lon" },
    { kyTu: "😅", ten: "cuoi xuat huyet goi go" },
    { kyTu: "😆", ten: "cuoi nhan mat" },
    { kyTu: "😹", ten: "meo cuoi khoc" },
    { kyTu: "💀", ten: "dau lau chet cuoi" },
    { kyTu: "🤪", ten: "dien khop" },
    { kyTu: "😜", ten: "nhao mom liem" },
    { kyTu: "🤭", ten: "che mieng cuoi" },
    { kyTu: "😏", ten: "cuoi xao" },
    { kyTu: "🤨", ten: "nhay mat nghi ngo" },
    { kyTu: "😬", ten: "nhai rang" },
    { kyTu: "🙃", ten: "lat nguoc" },
    { kyTu: "😊", ten: "cuoi mim" },
    { kyTu: "😗", ten: "hon gioi" },
    { kyTu: "😙", ten: "hon" },
  ],
  "Mạng xã hội": [
    { kyTu: "💬", ten: "bong thoai binh luan" },
    { kyTu: "🔔", ten: "chuong thong bao" },
    { kyTu: "❤️‍🔥", ten: "tim lua dang yeu" },
    { kyTu: "💔", ten: "tim vo" },
    { kyTu: "🤍", ten: "tim trang" },
    { kyTu: "💚", ten: "tim luc" },
    { kyTu: "💙", ten: "tim lam" },
    { kyTu: "💜", ten: "tim tim" },
    { kyTu: "🧡", ten: "tim cam" },
    { kyTu: "📢", ten: "loa phat thanh" },
    { kyTu: "#️⃣", ten: "hash tag the" },
    { kyTu: "✅", ten: "dau kiem dung" },
    { kyTu: "❌", ten: "dau che huy" },
    { kyTu: "⚠️", ten: "canh bao" },
    { kyTu: "💡", ten: "bong den y tuong" },
    { kyTu: "🔗", ten: "lien ket" },
  ],
  "Kỷ niệm": [
    { kyTu: "🎂", ten: "banh sinh nhat" },
    { kyTu: "🥂", ten: "nung can ly" },
    { kyTu: "🏆", ten: "cup huy chuong" },
    { kyTu: "🥇", ten: "nhat hang vang" },
    { kyTu: "🎖️", ten: "huy chuong" },
    { kyTu: "🎊", ten: "kim tuyến no" },
    { kyTu: "🎈", ten: "bong bay" },
    { kyTu: "🧨", ten: "phao hoa no" },
    { kyTu: "🎆", ten: "phao bong" },
    { kyTu: "🕯️", ten: "nen cay" },
    { kyTu: "🌹", ten: "hoa hong" },
    { kyTu: "🌻", ten: "huong duong" },
    { kyTu: "🍰", ten: "banh ngot" },
    { kyTu: "🥳", ten: "vui ve" },
    { kyTu: "💐", ten: "bo hoa" },
    { kyTu: "🎓", ten: "mu tot nghiep" },
  ],
  "Mũi tên": [
    { kyTu: "➡️", ten: "mui ten phai" },
    { kyTu: "⬅️", ten: "mui ten trai" },
    { kyTu: "⬆️", ten: "mui ten len" },
    { kyTu: "⬇️", ten: "mui ten xuong" },
    { kyTu: "↗️", ten: "mui ten len phai" },
    { kyTu: "↖️", ten: "mui ten len trai" },
    { kyTu: "↘️", ten: "mui ten xuong phai" },
    { kyTu: "↙️", ten: "mui ten xuong trai" },
    { kyTu: "🔵", ten: "hinh tron lam" },
    { kyTu: "🔺", ten: "tam giac do" },
    { kyTu: "🟡", ten: "vong tron vang" },
    { kyTu: "🟢", ten: "vong tron luc" },
    { kyTu: "🔴", ten: "vong tron do" },
    { kyTu: "⭕", ten: "vong tron to" },
    { kyTu: "❗", ten: "dau cham vang" },
    { kyTu: "❓", ten: "dau cham hoi" },
  ],
  "Hình học": [
    { kyTu: "⬛", ten: "hinh vuong den" },
    { kyTu: "⬜", ten: "hinh vuong trang" },
    { kyTu: "🔶", ten: "hinh vuong cam" },
    { kyTu: "🔷", ten: "hinh vuong xanh" },
    { kyTu: "🔸", ten: "hinh thoi cam nho" },
    { kyTu: "🔹", ten: "hinh thoi xanh nho" },
    { kyTu: "▪", ten: "hinh vuong nho" },
    { kyTu: "▫", ten: "hinh vuong nho trang" },
    { kyTu: "◾", ten: "hinh vuong den vua" },
    { kyTu: "◼", ten: "hinh vuong den vua a" },
    { kyTu: "🎯", ten: "trung tamia" },
    { kyTu: "⚪", ten: "hinh tron trang" },
    { kyTu: "⚫", ten: "hinh tron den" },
    { kyTu: "🔲", ten: "o vuong den" },
    { kyTu: "🔳", ten: "o vuong trang" },
    { kyTu: "➖", ten: "gach ngang" },
  ],
  "Trang trí": [
    { kyTu: "🌸", ten: "hoa anh dao" },
    { kyTu: "🍃", ten: "la xanh" },
    { kyTu: "🌙", ten: "trang" },
    { kyTu: "☀️", ten: "nang" },
    { kyTu: "⭐", ten: "sao trang" },
    { kyTu: "🌊", ten: "song bien" },
    { kyTu: "☁️", ten: "may" },
    { kyTu: "❄️", ten: "bang tuyet" },
    { kyTu: "🌺", ten: "hoa dai" },
    { kyTu: "🌼", ten: "hoa nho" },
    { kyTu: "💎", ten: "kim cuong" },
    { kyTu: "👑", ten: "vuong mien" },
    { kyTu: "🎀", ten: "nơ hinh" },
    { kyTu: "🪄", ten: "dua than phep" },
    { kyTu: "🧿", ten: "mat quy" },
    { kyTu: "🪩", ten: "guong nhao" },
  ],
};

/** Tổng số nhãn trong thư viện. */
export function soNhan(): number {
  return NHOM_NHAN.reduce((n, nhom) => n + THU_VIEN_NHAN[nhom].length, 0);
}

/**
 * Nhóm còn nhãn sau khi lọc theo từ khoá.
 *
 * Không dấu vẫn khớp: tên tìm kiếm ghi không dấu nên gõ "cuoi" cũng thấy nhóm
 * Cười lớn. Từ khoá rỗng thì trả về toàn bộ.
 */
export function locNhan(tuKhoa: string): Array<[NhomNhan, Nhan[]]> {
  const t = tuKhoa.trim().toLowerCase();
  const ra: Array<[NhomNhan, Nhan[]]> = [];
  for (const nhom of NHOM_NHAN) {
    const ds = t
      ? THU_VIEN_NHAN[nhom].filter(
          (n) =>
            n.ten.toLowerCase().includes(t) ||
            n.kyTu === t ||
            nhom.toLowerCase().includes(t)
        )
      : THU_VIEN_NHAN[nhom];
    if (ds.length > 0) ra.push([nhom, ds]);
  }
  return ra;
}

/** Nhãn dùng cho lần dùng gần đây, tối đa 8 mục. */
export function themNhanDaDung(cu: string[], kyTu: string): string[] {
  return [kyTu, ...cu.filter((k) => k !== kyTu)].slice(0, 8);
}