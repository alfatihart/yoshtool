// faker-data.js
// Dummy-data generators (Indonesian locale) + field matcher. PURE module with no
// chrome.*/DOM so it can run under `node --test` AND be imported by the popup. filler.js
// (classic content script) keeps an INLINE COPY of these functions — keep them in sync.

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const digits = (n) => Array.from({ length: n }, () => rand(10)).join("");
const pad = (v, n) => String(v).padStart(n, "0");

const FIRST_M = ["Budi", "Agus", "Rizki", "Dedi", "Andi", "Hendra", "Bayu", "Fajar", "Eko", "Dwi", "Yoga", "Irfan", "Rangga", "Satria", "Teguh"];
const FIRST_F = ["Siti", "Dewi", "Putri", "Ayu", "Rina", "Lestari", "Indah", "Maya", "Fitri", "Wulan", "Sari", "Nabila", "Anisa", "Ratna", "Dinda"];
const LAST = ["Wijaya", "Nugroho", "Santoso", "Hidayat", "Pratama", "Lestari", "Saputra", "Kurniawan", "Utami", "Permana", "Maulana", "Setiawan", "Anggraini", "Firmansyah", "Halim"];
const STREET = ["Merdeka", "Sudirman", "Diponegoro", "Gajah Mada", "Ahmad Yani", "Melati", "Mawar", "Kenanga", "Cendrawasih", "Pahlawan", "Veteran", "Kartini"];
const KEL = ["Sukamaju", "Harapan", "Sejahtera", "Mekarsari", "Cibadak", "Tamalanrea", "Sukajadi", "Pasir Putih"];
const KEC = ["Cibinong", "Tamalanrea", "Denpasar Barat", "Gubeng", "Coblong", "Medan Kota", "Tampan", "Kemayoran"];
const CITY = ["Jakarta", "Bandung", "Surabaya", "Makassar", "Medan", "Semarang", "Denpasar", "Yogyakarta", "Palembang", "Balikpapan"];
const PROVINCE = ["DKI Jakarta", "Jawa Barat", "Jawa Timur", "Sulawesi Selatan", "Sumatera Utara", "Jawa Tengah", "Bali", "DI Yogyakarta", "Sumatera Selatan", "Kalimantan Timur"];
const DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "mail.com", "example.com", "konsultanedu.com"];
const COMPANY_SUFFIX = ["Sejahtera", "Makmur", "Abadi", "Jaya", "Mandiri", "Sentosa", "Digital", "Teknologi"];
const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");

// BPS province codes (2 digits) for the NIK.
export const PROVINCE_CODES = ["11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "31", "32", "33", "34", "35", "36", "51", "52", "53", "61", "62", "63", "64", "65", "71", "72", "73", "74", "75", "76", "81", "82", "91", "94"];

// Indonesian mobile operator prefixes (4 digits including the leading 0).
export const PHONE_PREFIXES = [
  "0811", "0812", "0813", "0821", "0822", "0823", "0851", "0852", "0853", // Telkomsel
  "0814", "0815", "0816", "0855", "0856", "0857", "0858",                   // Indosat
  "0817", "0818", "0819", "0859", "0877", "0878",                           // XL
  "0831", "0832", "0833", "0838",                                           // Axis
  "0895", "0896", "0897", "0898", "0899",                                   // Tri
  "0881", "0882", "0883", "0884", "0885", "0886", "0887", "0888", "0889",   // Smartfren
];

// Account-number length per bank.
const BANK_ACCOUNT_LEN = [10, 13, 15, 11];

export function genFirstName(female = Math.random() < 0.5) {
  return pick(female ? FIRST_F : FIRST_M);
}
export function genLastName() {
  return pick(LAST);
}
export function genFullName() {
  const female = Math.random() < 0.5;
  return `${genFirstName(female)} ${genLastName()}`;
}
export function genUsername() {
  return (genFirstName() + genLastName()).toLowerCase() + rand(1000);
}
export function genEmail() {
  const user = (genFirstName() + "." + genLastName()).toLowerCase().replace(/\s+/g, "");
  return `${user}${rand(100)}@${pick(DOMAINS)}`;
}
export function genCompany() {
  return `PT ${genLastName()} ${pick(COMPANY_SUFFIX)}`;
}

// Indonesian phone number: real operator prefix + remaining digits (10–12 total).
export function genPhoneID() {
  return pick(PHONE_PREFIXES) + digits(6 + rand(3)); // 10–12 digits total
}

// 16-digit NIK: PP RR SS DDMMYY XXXX (DD +40 for females).
export function genNIK(female = Math.random() < 0.5) {
  const pp = pick(PROVINCE_CODES);
  const rr = pad(1 + rand(70), 2);
  const ss = pad(1 + rand(70), 2);
  let dd = 1 + rand(28);
  if (female) dd += 40;
  const mm = pad(1 + rand(12), 2);
  const yy = pad(rand(100), 2);
  const serial = pad(1 + rand(9999), 4);
  return `${pp}${rr}${ss}${pad(dd, 2)}${mm}${yy}${serial}`;
}

// NPWP: legacy 15-digit format XX.XXX.XXX.X-XXX.XXX.
export function genNPWP() {
  const d = digits(15);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12, 15)}`;
}

export function genRekening() {
  return digits(pick(BANK_ACCOUNT_LEN));
}
export function genKodePos() {
  return pad(10000 + rand(89999), 5);
}
export function genAddressID() {
  return `Jl. ${pick(STREET)} No. ${1 + rand(200)}, Kel. ${pick(KEL)}, Kec. ${pick(KEC)}, ${pick(CITY)}, ${pick(PROVINCE)} ${genKodePos()}`;
}
export function genCity() {
  return pick(CITY);
}
export function genProvince() {
  return pick(PROVINCE);
}
export function genUrl() {
  return `https://${genLastName().toLowerCase()}${rand(100)}.example.com`;
}
export function genDate() {
  const year = 1970 + rand(40);
  return `${year}-${pad(1 + rand(12), 2)}-${pad(1 + rand(28), 2)}`;
}
export function genNumber(min = 1, max = 1000) {
  return String(min + rand(max - min + 1));
}
export function genPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"[rand(24)];
  const lower = Array.from({ length: 6 }, () => "abcdefghijkmnpqrstuvwxyz"[rand(24)]).join("");
  return `${upper}${lower}${rand(100)}!`;
}
export function genLorem(words = 8) {
  return Array.from({ length: words }, () => pick(LOREM)).join(" ");
}
export function genWord() {
  return pick(LOREM);
}
export function genColor() {
  return "#" + pad(rand(0x1000000).toString(16), 6);
}
// Test card number (Visa test, passes Luhn) — safe for sandbox checkout.
export function genCreditCardTest() {
  return "4242424242424242";
}

// Dispatch a type to its string value.
export function generateFor(type) {
  switch (type) {
    case "email": return genEmail();
    case "first-name": return genFirstName();
    case "last-name": return genLastName();
    case "full-name": return genFullName();
    case "username": return genUsername();
    case "telephone": return genPhoneID();
    case "nik": return genNIK();
    case "npwp": return genNPWP();
    case "account": return genRekening();
    case "card": return genCreditCardTest();
    case "company": return genCompany();
    case "address": return genAddressID();
    case "zip": return genKodePos();
    case "city": return genCity();
    case "province": return genProvince();
    case "url": return genUrl();
    case "date": return genDate();
    case "number": return genNumber();
    case "password": return genPassword();
    case "color": return genColor();
    case "lorem": return genLorem();
    default: return genWord();
  }
}

// Field rules: type + alnum keywords (checked with `includes` against the normalized haystack).
// ORDER MATTERS (specific first): firstname before name, and so on.
export const FIELD_RULES = [
  { type: "email", kw: ["email", "surel"] },
  { type: "first-name", kw: ["firstname", "namadepan"] },
  { type: "last-name", kw: ["lastname", "surname", "namabelakang", "namakeluarga"] },
  { type: "username", kw: ["username", "userid", "namapengguna"] },
  { type: "nik", kw: ["nik", "nomorktp", "noktp", "ktp", "nomorinduk"] },
  { type: "npwp", kw: ["npwp"] },
  { type: "account", kw: ["norek", "rekening", "accountnumber", "accountno", "nomorrekening"] },
  { type: "card", kw: ["cardnumber", "cardno", "nomorkartu", "creditcard", "kartukredit", "kartudebit"] },
  { type: "telephone", kw: ["phone", "telephone", "telepon", "telp", "nohp", "handphone", "whatsapp", "mobile", "fax"] },
  { type: "company", kw: ["company", "perusahaan", "organization", "organisasi", "instansi"] },
  { type: "address", kw: ["address", "alamat", "street", "jalan"] },
  { type: "zip", kw: ["zip", "postal", "kodepos", "postcode"] },
  { type: "city", kw: ["city", "kota", "kabupaten"] },
  { type: "province", kw: ["province", "provinsi"] },
  { type: "url", kw: ["website", "url", "situs"] },
  { type: "date", kw: ["date", "tanggal", "tgl", "birthday", "lahir"] },
  { type: "password", kw: ["password", "sandi", "passwd"] },
  { type: "full-name", kw: ["fullname", "namalengkap", "nama", "name"] },
  { type: "number", kw: ["number", "angka", "jumlah", "qty", "quantity", "umur", "harga", "price"] },
];

export function normalizeHaystack(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Return the generator type from the field context + input type. null when no rule
// matches (the caller falls back to 'lorem'/'word').
export function matchField(haystack, inputType) {
  const t = String(inputType || "").toLowerCase();
  if (t === "email") return "email";
  if (t === "tel") return "telephone";
  if (t === "url") return "url";
  if (t === "number" || t === "range") return "number";
  if (t === "date" || t === "month" || t === "week" || t === "time" || t === "datetime-local") return "date";
  if (t === "password") return "password";
  if (t === "color") return "color";
  const norm = normalizeHaystack(haystack);
  for (const rule of FIELD_RULES) {
    for (const kw of rule.kw) {
      if (kw && norm.includes(kw)) return rule.type;
    }
  }
  return null;
}
