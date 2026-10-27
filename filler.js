// filler.js
// Isi semua input form dengan data dummy (fokus locale Indonesia). Disuntik on-demand
// via chrome.scripting.executeScript({files}) → CLASSIC script (tak bisa import), jadi
// generator + pencocok field di-INLINE dari faker-data.js (jaga tetap sinkron).
(() => {
  // ---- Generator (salinan inline faker-data.js) ----
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
  const PROVINCE_CODES = ["11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "31", "32", "33", "34", "35", "36", "51", "52", "53", "61", "62", "63", "64", "65", "71", "72", "73", "74", "75", "76", "81", "82", "91", "94"];
  const PHONE_PREFIXES = ["0811", "0812", "0813", "0821", "0822", "0823", "0851", "0852", "0853", "0814", "0815", "0816", "0855", "0856", "0857", "0858", "0817", "0818", "0819", "0859", "0877", "0878", "0831", "0832", "0833", "0838", "0895", "0896", "0897", "0898", "0899", "0881", "0882", "0883", "0884", "0885", "0886", "0887", "0888", "0889"];
  const BANK_ACCOUNT_LEN = [10, 13, 15, 11];

  const genFirstName = (f = Math.random() < 0.5) => pick(f ? FIRST_F : FIRST_M);
  const genLastName = () => pick(LAST);
  const genFullName = () => `${genFirstName(Math.random() < 0.5)} ${genLastName()}`;
  const genUsername = () => (genFirstName() + genLastName()).toLowerCase() + rand(1000);
  const genEmail = () => `${(genFirstName() + "." + genLastName()).toLowerCase().replace(/\s+/g, "")}${rand(100)}@${pick(DOMAINS)}`;
  const genCompany = () => `PT ${genLastName()} ${pick(COMPANY_SUFFIX)}`;
  const genPhoneID = () => pick(PHONE_PREFIXES) + digits(6 + rand(3));
  const genNIK = (f = Math.random() < 0.5) => {
    let dd = 1 + rand(28); if (f) dd += 40;
    return `${pick(PROVINCE_CODES)}${pad(1 + rand(70), 2)}${pad(1 + rand(70), 2)}${pad(dd, 2)}${pad(1 + rand(12), 2)}${pad(rand(100), 2)}${pad(1 + rand(9999), 4)}`;
  };
  const genNPWP = () => { const d = digits(15); return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12, 15)}`; };
  const genRekening = () => digits(pick(BANK_ACCOUNT_LEN));
  const genKodePos = () => pad(10000 + rand(89999), 5);
  const genAddressID = () => `Jl. ${pick(STREET)} No. ${1 + rand(200)}, Kel. ${pick(KEL)}, Kec. ${pick(KEC)}, ${pick(CITY)}, ${pick(PROVINCE)} ${genKodePos()}`;
  const genUrl = () => `https://${genLastName().toLowerCase()}${rand(100)}.example.com`;
  const genDate = () => `${1970 + rand(40)}-${pad(1 + rand(12), 2)}-${pad(1 + rand(28), 2)}`;
  const genNumber = (min = 1, max = 1000) => String(min + rand(max - min + 1));
  const genPassword = () => `${"ABCDEFGHJKLMNPQRSTUVWXYZ"[rand(24)]}${Array.from({ length: 6 }, () => "abcdefghijkmnpqrstuvwxyz"[rand(24)]).join("")}${rand(100)}!`;
  const genLorem = (w = 8) => Array.from({ length: w }, () => pick(LOREM)).join(" ");
  const genColor = () => "#" + pad(rand(0x1000000).toString(16), 6);

  function generateFor(type) {
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
      case "card": return "4242424242424242";
      case "company": return genCompany();
      case "address": return genAddressID();
      case "zip": return genKodePos();
      case "city": return pick(CITY);
      case "province": return pick(PROVINCE);
      case "url": return genUrl();
      case "date": return genDate();
      case "number": return genNumber();
      case "password": return genPassword();
      case "color": return genColor();
      case "lorem": return genLorem();
      default: return pick(LOREM);
    }
  }

  const FIELD_RULES = [
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
  const normalizeHaystack = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function matchField(haystack, inputType) {
    const t = String(inputType || "").toLowerCase();
    if (t === "email") return "email";
    if (t === "tel") return "telephone";
    if (t === "url") return "url";
    if (t === "number" || t === "range") return "number";
    if (t === "date" || t === "month" || t === "week" || t === "time" || t === "datetime-local") return "date";
    if (t === "password") return "password";
    if (t === "color") return "color";
    const norm = normalizeHaystack(haystack);
    for (const rule of FIELD_RULES) for (const kw of rule.kw) if (kw && norm.includes(kw)) return rule.type;
    return null;
  }

  // ---- DOM glue ----
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const protoSetter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
    const ownSetter = Object.getOwnPropertyDescriptor(el, "value") && Object.getOwnPropertyDescriptor(el, "value").set;
    if (protoSetter && ownSetter !== protoSetter) protoSetter.call(el, value);
    else if (ownSetter) ownSetter.call(el, value);
    else el.value = value;
  }
  function fire(el, withClick) {
    if (el._valueTracker) el._valueTracker.setValue("__yosh_force__" + Math.random()); // reset tracker React
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (withClick) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  function haystackFor(el) {
    const parts = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label")];
    if (el.labels) for (const lab of el.labels) parts.push(lab.textContent);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) for (const id of lb.split(/\s+/)) { const n = document.getElementById(id); if (n) parts.push(n.textContent); }
    return parts.filter(Boolean).join(" ");
  }
  // Sesuaikan string tanggal dgn tipe input date-family.
  function dateFor(type, iso) {
    const [y, m, d] = iso.split("-");
    if (type === "month") return `${y}-${m}`;
    if (type === "week") return `${y}-W${pad(1 + rand(52), 2)}`;
    if (type === "time") return `${pad(rand(24), 2)}:${pad(rand(60), 2)}`;
    if (type === "datetime-local") return `${iso}T${pad(rand(24), 2)}:${pad(rand(60), 2)}`;
    return `${y}-${m}-${d}`;
  }

  const SKIP_TYPES = new Set(["hidden", "button", "submit", "reset", "file", "image"]);
  const CONFIRM_RE = /(confirm|retype|reenter|repeat|ulangi|konfirmasi)/i;
  const AGREE_RE = /(agree|terms|setuju|syarat|ketentuan|tnc)/i;
  const CAPTCHA_RE = /captcha/i;

  function isOwnUi(el) {
    return !!(el.closest && el.closest("#__yoshtool_toast__, [data-yoshtool-redact-ui], [data-yoshtool-sensor]"));
  }

  async function run() {
    let skipFilled = false;
    try {
      const s = await chrome.storage.local.get("fakerSkipFilled");
      skipFilled = s.fakerSkipFilled === true;
    } catch { /* default fill semua */ }

    let count = 0;
    let lastValue = "";
    const radioGroupsDone = new Set();

    for (const el of document.querySelectorAll("input, textarea, select")) {
      const tag = el.tagName;
      const type = (el.type || "text").toLowerCase();
      if (tag === "INPUT" && SKIP_TYPES.has(type)) continue;
      if (el.disabled || el.readOnly) continue;
      if (isOwnUi(el)) continue;
      const hay = haystackFor(el);
      if (CAPTCHA_RE.test(hay)) continue;

      try {
        if (tag === "SELECT") {
          if (skipFilled && el.value) continue;
          const opts = [...el.options].filter((o) => !o.disabled && o.value !== "");
          if (!opts.length) continue;
          el.value = pick(opts).value;
          fire(el);
          count++;
          continue;
        }
        if (type === "checkbox") {
          const want = AGREE_RE.test(hay) ? true : Math.random() < 0.5;
          if (el.checked !== want) { el.checked = want; fire(el, true); }
          count++;
          continue;
        }
        if (type === "radio") {
          if (!el.name || radioGroupsDone.has(el.name)) continue;
          const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)].filter((r) => !r.disabled);
          if (!group.length) continue;
          const chosen = pick(group);
          chosen.checked = true;
          fire(chosen, true);
          radioGroupsDone.add(el.name);
          count++;
          continue;
        }
        // text-like
        if (skipFilled && el.value && el.value.trim()) continue;
        let value;
        if (CONFIRM_RE.test(hay) && lastValue) {
          value = lastValue; // samakan dgn field sebelumnya (mis. ulangi password)
        } else {
          const kind = matchField(hay, type);
          value = generateFor(kind || "lorem");
          if (kind === "date" || ["month", "week", "time", "datetime-local"].includes(type)) value = dateFor(type, genDate());
          if (type === "color") value = genColor();
        }
        if (el.maxLength && el.maxLength > 0 && value.length > el.maxLength) value = value.slice(0, el.maxLength);
        el.focus();
        setNativeValue(el, value);
        fire(el);
        el.blur();
        lastValue = value;
        count++;
      } catch { /* lewati elemen bermasalah */ }
    }

    showToast(count > 0 ? `${count} field diisi data dummy` : "Tak ada field yang bisa diisi", count === 0);
  }

  // Toast ringkas di halaman (pola sama dgn toast.js).
  function showToast(msg, isError) {
    const ID = "__yoshtool_toast__";
    document.getElementById(ID)?.remove();
    const el = document.createElement("div");
    el.id = ID;
    el.textContent = msg;
    el.style.cssText = [
      "position:fixed", "right:20px", "bottom:20px", "z-index:2147483647", "max-width:320px",
      "padding:12px 16px", "border-radius:8px", "font:14px/1.4 Arial,sans-serif", "color:#fff",
      "box-shadow:0 4px 16px rgba(0,0,0,0.3)", "opacity:0", "transition:opacity .2s ease",
      `background:${isError ? "#c62828" : "#2e7d32"}`,
    ].join(";");
    document.documentElement.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = "1"; });
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3000);
  }

  run();
})();
