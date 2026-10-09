import {
  NHOM_NHAN,
  THU_VIEN_NHAN,
  locNhan,
  soNhan,
  themNhanDaDung,
} from "./nhan";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`SAI  ${name}\n  thực tế: ${a}\n  cần:     ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Dữ liệu có đủ và không lỗi không
// ---------------------------------------------------------------------------

check("có tám nhóm nhãn", NHOM_NHAN.length, 8);
check("thứ tự nhóm hiển thị", NHOM_NHAN, [
  "Phổ biến",
  "Cảm xúc",
  "Cười lớn",
  "Mạng xã hội",
  "Kỷ niệm",
  "Mũi tên",
  "Hình học",
  "Trang trí",
]);

check("tổng số nhãn", soNhan(), 128);
for (const nhom of NHOM_NHAN) {
  const ds = THU_VIEN_NHAN[nhom];
  check(`nhóm ${nhom} có 16 nhãn`, ds.length, 16);
  const kyTu = ds.map((n) => n.kyTu);
  check(`nhóm ${nhom} không trùng ký tự`, new Set(kyTu).size, kyTu.length);
  check(`nhóm ${nhom} có tên tìm kiếm`, ds.every((n) => n.ten.length > 0), true);
  check(`nhóm ${nhom} không dấu trong tên`, ds.some((n) => /[àáảãạâầấẩẫậ]/.test(n.ten)), false);
}

// Không nhãn nào trùng nhau giữa các nhóm trừ nhãn dùng chung có chủ đích.
const tatCaCungNhieu = NHOM_NHAN.flatMap((n) => THU_VIEN_NHAN[n].map((x) => x.kyTu));
check("tổng số ký tự khớp", tatCaCungNhieu.length, soNhan());

// ---------------------------------------------------------------------------
// Lọc theo từ khoá
// ---------------------------------------------------------------------------

const toanBo = locNhan("");
check("từ khoá rỗng trả về mọi nhóm", toanBo.length, 8);
check(
  "từ khoá rỗng giữ đủ số nhãn",
  toanBo.flatMap(([, ds]) => ds).length,
  soNhan()
);
check(
  "thứ tự nhóm không đổi sau khi lọc trống",
  toanBo.map(([n]) => n),
  NHOM_NHAN.slice()
);

const timCuoi = locNhan("cuoi");
check("tìm cuoi thấy nhóm Cười lớn", timCuoi.some(([n]) => n === "Cười lớn"), true);
check("tìm cuoi không ra nhóm Hình học", timCuoi.some(([n]) => n === "Hình học"), false);
check("tìm cuoi ra cả hai nhóm có nhãn cuoi", timCuoi.length, 2);

const timTim = locNhan("tim");
check("tìm tim ra nhóm Mạng xã hội", timTim.some(([n]) => n === "Mạng xã hội"), true);
check("tìm tim ra chính nó", timTim.some(([, ds]) => ds.some((n) => n.kyTu.includes("❤️"))), true);
check("tìm tim ra nhóm Mạng xã hội", timTim.some(([n]) => n === "Mạng xã hội"), true);
check(
  "tìm tim ra ít nhất bốn nhãn",
  timTim.flatMap(([, ds]) => ds).length >= 4,
  true
);

const timTenNhom = locNhan("mũi tên");
check("tìm theo tên nhóm được", timTenNhom.map(([n]) => n).includes("Mũi tên"), true);

check("tìm theo đúng ký tự được", locNhan("🚀").flatMap(([, ds]) => ds).length, 1);

const timHoa = locNhan("hoa");
check("tìm hoa thấy nhãn hoa", timHoa.flatMap(([, ds]) => ds).some((n) => n.kyTu.includes("🌸")), true);

check("từ khoá vô nghĩa trả về rỗng", locNhan("zzzqqq").length, 0);
check("từ khoá toàn dấu cách coi như rỗng", locNhan("   ").length, 8);
check("tìm không phân biệt hoa thường", locNhan("CUOI").length, locNhan("cuoi").length);
check("tìm được có dấu thanh", locNhan("mũi tên").length, 1);

// ---------------------------------------------------------------------------
// Nhãn vừa dùng
// ---------------------------------------------------------------------------

check("thêm nhãn mới vào đầu", themNhanDaDung(["a", "b"], "c"), ["c", "a", "b"]);
check("nhãn đã có được đưa lên đầu", themNhanDaDung(["a", "b", "c"], "a"), ["a", "b", "c"]);
check("không để trùng nhãn", new Set(themNhanDaDung(["a", "b"], "a")).size, 2);
check("tối đa tám nhãn", themNhanDaDung(["1", "2", "3", "4", "5", "6", "7", "8"], "9").length, 8);
check("nhãn mới nhất nằm đầu", themNhanDaDung(["1", "2", "3", "4", "5", "6", "7", "8"], "9")[0], "9");
check("thêm vào danh sách rỗng", themNhanDaDung([], "x"), ["x"]);

console.log(`\n${passed} đạt, ${failed} sai`);
if (failed > 0) throw new Error(`${failed} phép kiểm tra sai}`);