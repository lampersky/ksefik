const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const exportBtn = document.getElementById("exportBtn");
const preview = document.getElementById("preview");
const fileHash = document.getElementById("fileHash");
const errorBox = document.getElementById("error");
const appTitle = document.getElementById("appTitle");
const appSubtitle = document.getElementById("appSubtitle");
const langLabel = document.getElementById("langLabel");
const langSelect = document.getElementById("langSelect");
const pdfNamePatternSelect = document.getElementById("pdfNamePatternSelect");
const dropzoneText = document.getElementById("dropzoneText");

let currentInvoice = null;
let currentVerificationUrl = "";
let currentShaBase64Url = "";
let currentUploadedFileBaseName = "";
let pdfFontLoadPromise = null;
let i18n = {};
let currentLang = "en";
const PDF_FONT_FAMILY = "NotoSans";
const STORAGE_KEYS = {
  language: "invoicePreview.language",
  pdfNamePattern: "invoicePreview.pdfNamePattern"
};

const textOrDash = (v) => (v && String(v).trim().length ? String(v).trim() : "-");

function t(key, vars = {}) {
  let value = i18n[key] ?? key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_err) {
    // Ignore storage errors (private mode/restricted storage).
  }
}

function hasOptionValue(select, value) {
  if (!select || !value) return false;
  return Array.from(select.options).some((option) => option.value === value);
}

function setPreviewEmpty() {
  preview.innerHTML = `<p class="muted">${t("preview.empty")}</p>`;
}

function updateLanguageOptionLabels() {
  const enOption = langSelect.querySelector('option[value="en"]');
  const plOption = langSelect.querySelector('option[value="pl"]');
  if (enOption) enOption.textContent = t("language.option.en");
  if (plOption) plOption.textContent = t("language.option.pl");
}

function renderHashInfo() {
  if (currentVerificationUrl) {
    fileHash.innerHTML = `${t("hash.verificationUrl")}: <a href="${currentVerificationUrl}" target="_blank" rel="noopener noreferrer">${currentVerificationUrl}</a>`;
    return;
  }
  if (currentShaBase64Url) {
    fileHash.textContent = `${t("hash.sha256Base64Url")}: ${currentShaBase64Url}`;
    return;
  }
  fileHash.textContent = "";
}

function setStaticTexts() {
  document.title = t("app.title");
  appTitle.textContent = t("app.title");
  appSubtitle.textContent = t("app.subtitle");
  langLabel.textContent = t("language.label");
  dropzoneText.innerHTML = `<strong>${t("dropzone.strong")}</strong> ${t("dropzone.rest")}`;
  dropzone.setAttribute("aria-label", t("dropzone.ariaLabel"));
  browseBtn.textContent = t("button.browse");
  exportBtn.textContent = t("button.export");
  updateLanguageOptionLabels();
  if (!currentInvoice) setPreviewEmpty();
  renderHashInfo();
}

async function loadLocale(lang) {
  const response = await fetch(`i18n/${lang}.json`);
  if (!response.ok) throw new Error(`Failed to load language file: ${lang}`);
  i18n = await response.json();
  currentLang = lang;
}

async function applyLanguage(lang) {
  try {
    await loadLocale(lang);
  } catch (_err) {
    if (lang !== "en") await loadLocale("en");
  }
  langSelect.value = currentLang;
  setStaticTexts();
  if (currentInvoice) preview.innerHTML = invoiceToHtml(currentInvoice);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function ensurePdfUnicodeFont(doc) {
  const existingFonts = doc.getFontList();
  if (existingFonts[PDF_FONT_FAMILY]) return;

  if (!pdfFontLoadPromise) {
    pdfFontLoadPromise = (async () => {
      const regularUrl = "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
      const boldUrl = "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf";

      const [regularRes, boldRes] = await Promise.all([fetch(regularUrl), fetch(boldUrl)]);
      if (!regularRes.ok || !boldRes.ok) throw new Error(t("error.unicodeFont"));

      const [regularBuffer, boldBuffer] = await Promise.all([regularRes.arrayBuffer(), boldRes.arrayBuffer()]);
      doc.addFileToVFS("NotoSans-Regular.ttf", arrayBufferToBase64(regularBuffer));
      doc.addFont("NotoSans-Regular.ttf", PDF_FONT_FAMILY, "normal", "Identity-H");
      doc.addFileToVFS("NotoSans-Bold.ttf", arrayBufferToBase64(boldBuffer));
      doc.addFont("NotoSans-Bold.ttf", PDF_FONT_FAMILY, "bold", "Identity-H");
    })().catch((err) => {
      pdfFontLoadPromise = null;
      throw err;
    });
  }

  await pdfFontLoadPromise;
}

function byLocalName(root, name) {
  if (!root) return null;
  return Array.from(root.getElementsByTagName("*")).find((node) => node.localName === name) || null;
}

function childrenByLocalName(root, name) {
  if (!root) return [];
  return Array.from(root.getElementsByTagName("*")).filter((node) => node.localName === name);
}

function textByPath(root, path) {
  let node = root;
  for (const segment of path) {
    if (!node) return "";
    node = Array.from(node.children || []).find((child) => child.localName === segment);
  }
  return node ? node.textContent.trim() : "";
}

function toNumber(value) {
  if (!value && value !== 0) return null;
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmount(value, currency) {
  const numberValue = toNumber(value);
  if (numberValue === null) return textOrDash(value);
  const safeCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : "PLN";
  try {
    return new Intl.NumberFormat(currentLang === "pl" ? "pl-PL" : "en-US", { style: "currency", currency: safeCurrency }).format(numberValue);
  } catch (_err) {
    return `${numberValue.toFixed(2)} ${safeCurrency}`;
  }
}

function yesNoMark(flag) {
  if (flag === "1") return t("common.yes");
  if (flag === "2") return t("common.no");
  return "-";
}

function paymentFormLabel(code) {
  const value = String(code || "").trim();
  if (!value) return "-";
  const key = `payment.form.${value}`;
  return i18n[key] ? t(key) : t("payment.form.other");
}

function countryNameFromCode(code) {
  const value = String(code || "").trim().toUpperCase();
  if (!value) return "-";
  try {
    const locale = currentLang === "pl" ? "pl" : "en";
    const display = new Intl.DisplayNames([locale], { type: "region" });
    return display.of(value) || value;
  } catch (_err) {
    return value;
  }
}

function formatGeneratedTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  return raw;
}

function sanitizeFilenamePart(value, fallback = "export") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function buildPdfFilename(invoice) {
  const selectedPattern = pdfNamePatternSelect?.value || "seller_month_year";
  const sellerName = sanitizeFilenamePart(invoice?.seller?.name, "seller");
  const cleanNumber = sanitizeFilenamePart(invoice?.meta?.number, "export");
  const issueDate = String(invoice?.meta?.issueDate || "").trim();
  const parsedIssueDate = issueDate ? new Date(`${issueDate}T00:00:00`) : null;
  const isValidIssueDate = parsedIssueDate && !Number.isNaN(parsedIssueDate.getTime());
  const monthName = isValidIssueDate
    ? new Intl.DateTimeFormat(currentLang === "pl" ? "pl-PL" : "en-US", { month: "long" }).format(parsedIssueDate)
    : "month";
  const year = isValidIssueDate ? String(parsedIssueDate.getFullYear()) : "year";
  const cleanMonth = sanitizeFilenamePart(monthName, "month");
  const cleanYear = sanitizeFilenamePart(year, "year");

  if (selectedPattern === "seller_clean_number") {
    return `${sellerName}_${cleanNumber}.PDF`;
  }
  if (selectedPattern === "invoice_clean_number") {
    return `invoice-${cleanNumber}.PDF`;
  }
  return `${sellerName}_${cleanMonth}_${cleanYear}.PDF`;
}

function vatRateExplanation(code) {
  const normalized = String(code || "").trim().toLowerCase();
  const keyMap = {
    zw: "vat.expl.zw",
    oo: "vat.expl.oo",
    np: "vat.expl.np",
    "np i": "vat.expl.np_i",
    "np ii": "vat.expl.np_ii"
  };
  const key = keyMap[normalized];
  return key ? t(key) : "";
}

function vatRateDisplay(code) {
  const raw = textOrDash(code);
  if (raw === "-") return raw;
  return vatRateExplanation(raw) ? `${raw} (*)` : raw;
}

function usedVatLegendEntries(items) {
  const seen = new Set();
  const entries = [];
  for (const item of items || []) {
    const raw = String(item.vatRate || "").trim();
    const normalized = raw.toLowerCase();
    const explanation = vatRateExplanation(raw);
    if (!raw || !explanation || seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push({ code: raw, explanation });
  }
  return entries;
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64UrlFromFile(file) {
  if (!window.crypto || !window.crypto.subtle) throw new Error(t("error.shaUnsupported"));
  const bytes = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return bufferToBase64Url(digest);
}

function buildVerificationUrl(invoice, shaBase64Url) {
  const sellerNip = String(invoice?.seller?.nip || "").trim();
  const issueDateQr = formatIssueDateForQr(invoice?.meta?.issueDate);
  if (!sellerNip || !issueDateQr || !shaBase64Url) return "";
  return `https://qr.ksef.mf.gov.pl/invoice/${encodeURIComponent(sellerNip)}/${encodeURIComponent(issueDateQr)}/${encodeURIComponent(shaBase64Url)}`;
}

async function qrCodeDataUrl(text, size = 96) {
  if (!text || !window.QRCode) return "";
  const mount = document.createElement("div");
  mount.style.position = "fixed";
  mount.style.left = "-9999px";
  mount.style.top = "0";
  document.body.appendChild(mount);
  try {
    new QRCode(mount, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const canvas = mount.querySelector("canvas");
    if (canvas) return canvas.toDataURL("image/png");
    const img = mount.querySelector("img");
    if (img && img.src) return img.src;
    return "";
  } finally {
    mount.remove();
  }
}

function composePartyTaxId(podmiot) {
  const nip = textByPath(podmiot, ["DaneIdentyfikacyjne", "NIP"]);
  if (nip) {
    const prefix = textByPath(podmiot, ["PrefiksPodatnika"]);
    return `${prefix}${nip}`.trim();
  }

  const nrVatUE = textByPath(podmiot, ["DaneIdentyfikacyjne", "NrVatUE"]);
  if (nrVatUE) {
    const kodUE = textByPath(podmiot, ["DaneIdentyfikacyjne", "KodUE"]);
    return `${kodUE}${nrVatUE}`.trim();
  }

  return "";
}

function formatIssueDateForQr(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return "";
}

function parseInvoice(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error(t("error.invalidXml"));

  const root = doc.documentElement;
  if (!root || root.localName !== "Faktura") throw new Error(t("error.invalidRoot"));

  const header = byLocalName(root, "Naglowek");
  const seller = byLocalName(root, "Podmiot1");
  const buyer = byLocalName(root, "Podmiot2");
  const fa = byLocalName(root, "Fa");
  if (!fa) throw new Error(t("error.missingFa"));

  const payment = byLocalName(fa, "Platnosc");
  const bank = byLocalName(payment, "RachunekBankowy");
  const annotations = byLocalName(fa, "Adnotacje");
  const rows = childrenByLocalName(fa, "FaWiersz");
  const currency = textByPath(fa, ["KodWaluty"]) || "PLN";

  return {
    meta: {
      number: textByPath(fa, ["P_2"]),
      issueDate: textByPath(fa, ["P_1"]),
      dueDate: textByPath(fa, ["P_6"]),
      saleDate: textByPath(fa, ["P_6"]),
      currency,
      totalFormatted: formatAmount(textByPath(fa, ["P_15"]), currency),
      invoiceType: textByPath(fa, ["RodzajFaktury"]),
      generatedAt: formatGeneratedTimestamp(textByPath(header, ["DataWytworzeniaFa"])),
      systemInfo: textByPath(header, ["SystemInfo"]),
      exchangeRate: textByPath(byLocalName(rows[0], "KursWaluty") ? rows[0] : fa, ["KursWaluty"])
    },
    seller: {
      name: textByPath(seller, ["DaneIdentyfikacyjne", "Nazwa"]),
      nip: textByPath(seller, ["DaneIdentyfikacyjne", "NIP"]),
      taxId: composePartyTaxId(seller),
      country: countryNameFromCode(textByPath(seller, ["Adres", "KodKraju"])),
      address: textByPath(seller, ["Adres", "AdresL1"])
    },
    buyer: {
      name: textByPath(buyer, ["DaneIdentyfikacyjne", "Nazwa"]),
      taxId: composePartyTaxId(buyer),
      country: countryNameFromCode(textByPath(buyer, ["Adres", "KodKraju"])),
      address: textByPath(buyer, ["Adres", "AdresL1"])
    },
    totals: {
      p13_1: textByPath(fa, ["P_13_1"]),
      p13_2: textByPath(fa, ["P_13_2"]),
      p13_3: textByPath(fa, ["P_13_3"]),
      p13_4: textByPath(fa, ["P_13_4"]),
      p13_5: textByPath(fa, ["P_13_5"]),
      p13_6: textByPath(fa, ["P_13_6"]),
      p13_7: textByPath(fa, ["P_13_7"]),
      p13_8: textByPath(fa, ["P_13_8"]),
      p13_9: textByPath(fa, ["P_13_9"])
    },
    payment: {
      form: paymentFormLabel(textByPath(payment, ["FormaPlatnosci"])),
      accountNumber: textByPath(bank, ["NrRB"]),
      swift: textByPath(bank, ["SWIFT"]),
      bankName: textByPath(bank, ["NazwaBanku"])
    },
    annotations: {
      reverseCharge: yesNoMark(textByPath(annotations, ["P_18"])),
      splitPayment: yesNoMark(textByPath(annotations, ["P_17"])),
      cashMethod: yesNoMark(textByPath(annotations, ["P_16"])),
      newTransport: yesNoMark(textByPath(annotations, ["NoweSrodkiTransportu", "P_22N"])),
      exemption: yesNoMark(textByPath(annotations, ["Zwolnienie", "P_19N"])),
      marginProcedure: yesNoMark(textByPath(annotations, ["PMarzy", "P_PMarzyN"])),
      p23Flag: yesNoMark(textByPath(annotations, ["P_23"]))
    },
    items: rows.map((row) => {
      const net = textByPath(row, ["P_9A"]);
      const value = textByPath(row, ["P_11"]);
      return {
        lineNo: textByPath(row, ["NrWierszaFa"]),
        description: textByPath(row, ["P_7"]),
        quantity: textByPath(row, ["P_8B"]),
        unit: textByPath(row, ["P_8A"]),
        vatRate: textByPath(row, ["P_12"]),
        net: formatAmount(net, currency),
        lineValue: formatAmount(value, currency)
      };
    })
  };
}

function invoiceToHtml(invoice) {
  const totalsLabels = {
    p13_1: t("totals.p13_1"),
    p13_2: t("totals.p13_2"),
    p13_3: t("totals.p13_3"),
    p13_4: t("totals.p13_4"),
    p13_5: t("totals.p13_5"),
    p13_6: t("totals.p13_6"),
    p13_7: t("totals.p13_7"),
    p13_8: t("totals.p13_8"),
    p13_9: t("totals.p13_9")
  };

  const rows = Object.entries(invoice.totals).filter(([, value]) => String(value || "").trim().length);
  const totalsHtml = rows.length
    ? rows.map(([key, value]) => `<div class="kv"><div class="label">${totalsLabels[key] || key}</div><div>${formatAmount(value, invoice.meta.currency)}</div></div>`).join("")
    : `<div class="kv"><div class="label">${t("totals.noneLabel")}</div><div>-</div></div>`;

  const itemsRows = invoice.items.length
    ? invoice.items.map((item) => `
        <tr>
          <td>${textOrDash(item.lineNo)}</td>
          <td>${textOrDash(item.description)}</td>
          <td>${textOrDash(item.quantity)}</td>
          <td>${textOrDash(item.unit)}</td>
          <td>${vatRateDisplay(item.vatRate)}</td>
          <td>${textOrDash(item.net)}</td>
          <td>${textOrDash(item.lineValue)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="7" class="muted">${t("items.none")}</td></tr>`;

  const vatLegendEntries = usedVatLegendEntries(invoice.items);
  const vatLegendHtml = vatLegendEntries.length
    ? `<p class="muted">${t("vat.legendPrefix")} ${vatLegendEntries.map((entry) => `${entry.code} - ${entry.explanation}`).join(" ")}</p>`
    : "";

  return `
    <div class="grid">
      <article class="card">
        <h3>${t("section.invoice")}</h3>
        <div class="kv"><div class="label">${t("field.number")}</div><div>${textOrDash(invoice.meta.number)}</div></div>
        <div class="kv"><div class="label">${t("field.issueDate")}</div><div>${textOrDash(invoice.meta.issueDate)}</div></div>
        <div class="kv"><div class="label">${t("field.dueDate")}</div><div>${textOrDash(invoice.meta.dueDate)}</div></div>
        <div class="kv"><div class="label">${t("field.type")}</div><div>${textOrDash(invoice.meta.invoiceType)}</div></div>
        <div class="kv"><div class="label">${t("field.currency")}</div><div>${textOrDash(invoice.meta.currency)}</div></div>
        <div class="kv"><div class="label">${t("field.total")}</div><div>${textOrDash(invoice.meta.totalFormatted)}</div></div>
      </article>
      <article class="card">
        <h3>${t("section.seller")}</h3>
        <div class="kv"><div class="label">${t("field.name")}</div><div>${textOrDash(invoice.seller.name)}</div></div>
        <div class="kv"><div class="label">${t("field.taxId")}</div><div>${textOrDash(invoice.seller.taxId)}</div></div>
        <div class="kv"><div class="label">${t("field.country")}</div><div>${textOrDash(invoice.seller.country)}</div></div>
        <div class="kv"><div class="label">${t("field.address")}</div><div>${textOrDash(invoice.seller.address).replace(/\n/g, "<br>")}</div></div>
      </article>
      <article class="card">
        <h3>${t("section.buyer")}</h3>
        <div class="kv"><div class="label">${t("field.name")}</div><div>${textOrDash(invoice.buyer.name)}</div></div>
        <div class="kv"><div class="label">${t("field.taxId")}</div><div>${textOrDash(invoice.buyer.taxId)}</div></div>
        <div class="kv"><div class="label">${t("field.country")}</div><div>${textOrDash(invoice.buyer.country)}</div></div>
        <div class="kv"><div class="label">${t("field.address")}</div><div>${textOrDash(invoice.buyer.address).replace(/\n/g, "<br>")}</div></div>
      </article>
    </div>

    <div class="grid">
      <article class="card">
        <h3>${t("section.mappedTotals")}</h3>
        ${totalsHtml}
      </article>
      <article class="card">
        <h3>${t("section.payment")}</h3>
        <div class="kv"><div class="label">${t("field.form")}</div><div>${textOrDash(invoice.payment.form)}</div></div>
        <div class="kv"><div class="label">${t("field.bank")}</div><div>${textOrDash(invoice.payment.bankName)}</div></div>
        <div class="kv"><div class="label">${t("field.account")}</div><div>${textOrDash(invoice.payment.accountNumber)}</div></div>
        <div class="kv"><div class="label">${t("field.swift")}</div><div>${textOrDash(invoice.payment.swift)}</div></div>
        <div class="kv"><div class="label">${t("field.fxRate")}</div><div>${textOrDash(invoice.meta.exchangeRate)}</div></div>
      </article>
      <article class="card">
        <h3>${t("section.annotations")}</h3>
        <div class="kv"><div class="label">${t("field.reverseCharge")}</div><div>${textOrDash(invoice.annotations.reverseCharge)}</div></div>
      </article>
    </div>

    <h3 style="margin-top: 8px;">${t("section.lineItems")}</h3>
    <table>
      <thead>
        <tr>
          <th>${t("table.no")}</th>
          <th>${t("table.description")}</th>
          <th>${t("table.qty")}</th>
          <th>${t("table.unit")}</th>
          <th>${t("table.vat")}</th>
          <th>${t("table.net")}</th>
          <th>${t("table.value")}</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>
    ${vatLegendHtml}

    <p class="muted">${t("footer.generated")}: ${textOrDash(invoice.meta.generatedAt)} | ${t("footer.source")}: ${textOrDash(invoice.meta.systemInfo)}</p>
  `;
}

async function loadFile(file) {
  errorBox.textContent = "";
  currentVerificationUrl = "";
  currentShaBase64Url = "";
  currentUploadedFileBaseName = "";

  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".xml")) {
    errorBox.textContent = t("error.provideXml");
    renderHashInfo();
    return;
  }
  currentUploadedFileBaseName = file.name.replace(/\.xml$/i, "");
  fileHash.textContent = `${t("hash.sha256")} ${t("status.calculating")}`;

  try {
    const [xmlText, shaBase64Url] = await Promise.all([file.text(), sha256Base64UrlFromFile(file)]);
    currentShaBase64Url = shaBase64Url;
    const invoice = parseInvoice(xmlText);
    currentVerificationUrl = buildVerificationUrl(invoice, shaBase64Url);
    renderHashInfo();
    currentInvoice = invoice;
    preview.innerHTML = invoiceToHtml(invoice);
    exportBtn.disabled = false;
  } catch (err) {
    currentInvoice = null;
    exportBtn.disabled = true;
    setPreviewEmpty();
    errorBox.textContent = err instanceof Error ? err.message : t("error.readFailed");
    if (String(fileHash.textContent).includes(t("status.calculating"))) fileHash.textContent = "";
  }
}

async function exportPdf() {
  if (!currentInvoice) return;
  const jsPDFRef = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFRef) {
    errorBox.textContent = t("error.jspdfMissing");
    return;
  }

  const invoice = currentInvoice;
  const doc = new jsPDFRef({ unit: "pt", format: "a4" });
  try {
    await ensurePdfUnicodeFont(doc);
  } catch (err) {
    errorBox.textContent = err instanceof Error ? err.message : t("error.unicodePrepare");
    return;
  }

  const page = { width: doc.internal.pageSize.getWidth(), height: doc.internal.pageSize.getHeight(), margin: 34 };
  let y = page.margin;
  let qrImageDataUrl = "";
  try {
    qrImageDataUrl = await qrCodeDataUrl(currentVerificationUrl, 100);
  } catch (_err) {
    qrImageDataUrl = "";
  }

  const checkPage = (heightNeeded = 24) => {
    if (y + heightNeeded > page.height - page.margin) {
      doc.addPage();
      y = page.margin;
    }
  };

  const drawTitle = () => {
    const qrSize = 50;
    const qrPadding = 6;
    const contentX = page.margin + 14;
    const contentWidth = page.width - page.margin * 2 - 28;
    const qrReservedWidth = qrImageDataUrl ? qrSize + qrPadding * 2 + 8 : 0;
    let rightBlockWidth = Math.min(170, Math.max(120, contentWidth * 0.34));
    let leftMaxWidth = contentWidth - qrReservedWidth - rightBlockWidth - 12;
    if (leftMaxWidth < 140) {
      const widthDeficit = 140 - leftMaxWidth;
      rightBlockWidth = Math.max(90, rightBlockWidth - widthDeficit);
      leftMaxWidth = contentWidth - qrReservedWidth - rightBlockWidth - 12;
    }
    const rightTextX = contentX + leftMaxWidth + 12;

    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(18);
    const titleLines = doc.splitTextToSize(t("pdf.headerTitle"), leftMaxWidth);
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(10);
    const numberLines = doc.splitTextToSize(`${t("field.number")}: ${textOrDash(invoice.meta.number)}`, leftMaxWidth);
    const issueDateLines = doc.splitTextToSize(`${t("field.issueDate")}: ${textOrDash(invoice.meta.issueDate)}`, rightBlockWidth);
    const dueDateLines = doc.splitTextToSize(`${t("field.dueDate")}: ${textOrDash(invoice.meta.dueDate)}`, rightBlockWidth);
    const leftBlockBottom = y + 24 + titleLines.length * 16 + numberLines.length * 10;
    const rightBlockBottom = y + 26 + issueDateLines.length * 10 + 4 + dueDateLines.length * 10;
    const headerHeight = Math.max(68, Math.ceil(Math.max(leftBlockBottom, rightBlockBottom) - y + 10));

    doc.setFillColor(25, 55, 109);
    doc.roundedRect(page.margin, y, page.width - page.margin * 2, headerHeight, 6, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(18);
    let titleY = y + 24;
    for (const line of titleLines) {
      doc.text(line, contentX, titleY);
      titleY += 16;
    }
    doc.setFontSize(10);
    doc.setFont(PDF_FONT_FAMILY, "normal");
    let numberY = titleY;
    for (const line of numberLines) {
      doc.text(line, contentX, numberY);
      numberY += 10;
    }
    let rightY = y + 26;
    for (const line of issueDateLines) {
      doc.text(line, rightTextX, rightY);
      rightY += 10;
    }
    rightY += 4;
    for (const line of dueDateLines) {
      doc.text(line, rightTextX, rightY);
      rightY += 10;
    }
    if (qrImageDataUrl) {
      doc.setFillColor(255, 255, 255);
      const qrX = page.width - page.margin - qrSize - qrPadding;
      const qrY = y + (headerHeight - qrSize) / 2;
      doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 3, 3, "F");
      doc.addImage(qrImageDataUrl, "PNG", qrX, qrY, qrSize, qrSize);
    }
    doc.setTextColor(20, 20, 20);
    y += headerHeight + 16;
  };

  const drawInfoBox = (title, lines, x, boxY, width, height) => {
    doc.setDrawColor(130, 130, 130);
    doc.roundedRect(x, boxY, width, height, 4, 4);
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(11);
    const titleLines = doc.splitTextToSize(String(title), width - 20);
    let titleY = boxY + 16;
    for (const titleLine of titleLines) {
      doc.text(titleLine, x + 10, titleY);
      titleY += 11;
    }
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(9.5);
    let lineY = titleY + 3;
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(String(line), width - 20);
      for (const wrappedLine of wrapped) {
        if (lineY > boxY + height - 8) break;
        doc.text(wrappedLine, x + 10, lineY);
        lineY += 12;
      }
    }
  };

  drawTitle();
  checkPage(110);

  const leftX = page.margin;
  const boxY = y;
  const boxWidth = (page.width - page.margin * 2 - 12) / 2;
  const boxHeight = 102;

  drawInfoBox(t("section.seller"), [
    invoice.seller.name,
    `${t("field.taxId")}: ${textOrDash(invoice.seller.taxId)}`,
    `${t("field.country")}: ${textOrDash(invoice.seller.country)}`,
    textOrDash(invoice.seller.address).replace(/\n/g, ", ")
  ], leftX, boxY, boxWidth, boxHeight);

  drawInfoBox(t("section.buyer"), [
    invoice.buyer.name,
    `${t("field.taxId")}: ${textOrDash(invoice.buyer.taxId)}`,
    `${t("field.country")}: ${textOrDash(invoice.buyer.country)}`,
    textOrDash(invoice.buyer.address).replace(/\n/g, ", ")
  ], leftX + boxWidth + 12, boxY, boxWidth, boxHeight);

  y += boxHeight + 14;
  checkPage(76);

  drawInfoBox(t("pdf.invoiceDetails"), [
    `${t("field.type")}: ${textOrDash(invoice.meta.invoiceType)}`,
    `${t("field.currency")}: ${textOrDash(invoice.meta.currency)}`,
    `${t("field.total")}: ${textOrDash(invoice.meta.totalFormatted)}`,
    `${t("field.fxRate")}: ${textOrDash(invoice.meta.exchangeRate)}`
  ], page.margin, y, page.width - page.margin * 2, 64);

  y += 84;
  checkPage(56);

  const colWidths = [30, 170, 40, 72, 55, 82, 83];
  const headers = [t("table.no"), t("table.description"), t("table.qty"), t("table.unit"), t("table.vat"), t("table.net"), t("table.value")];
  const tableX = page.margin;
  const tableWidth = colWidths.reduce((sum, n) => sum + n, 0);

  const drawTableHeader = () => {
    const headerLines = headers.map((header, index) => doc.splitTextToSize(header, colWidths[index] - 8));
    const maxHeaderLines = Math.max(...headerLines.map((lines) => lines.length));
    const headerHeight = Math.max(22, maxHeaderLines * 9 + 8);
    doc.setFillColor(238, 242, 247);
    doc.rect(tableX, y, tableWidth, headerHeight, "F");
    doc.setDrawColor(120, 120, 120);
    doc.rect(tableX, y, tableWidth, headerHeight);
    let x = tableX;
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(9);
    for (let i = 0; i < headers.length; i += 1) {
      const w = colWidths[i];
      if (i > 0) doc.line(x, y, x, y + headerHeight);
      let headerY = y + 12;
      for (const headerLine of headerLines[i]) {
        doc.text(headerLine, x + 4, headerY);
        headerY += 9;
      }
      x += w;
    }
    y += headerHeight;
  };

  drawTableHeader();
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8.8);

  const items = invoice.items.length ? invoice.items : [{ lineNo: "-", description: t("items.none"), quantity: "-", unit: "-", vatRate: "-", net: "-", lineValue: "-" }];
  for (const item of items) {
    const rowValues = [textOrDash(item.lineNo), textOrDash(item.description), textOrDash(item.quantity), textOrDash(item.unit), vatRateDisplay(item.vatRate), textOrDash(item.net), textOrDash(item.lineValue)];
    const descLines = doc.splitTextToSize(rowValues[1], colWidths[1] - 6);
    const rowHeight = Math.max(20, descLines.length * 10 + 6);
    checkPage(rowHeight + 1);
    if (y === page.margin) drawTableHeader();

    doc.rect(tableX, y, tableWidth, rowHeight);
    let x = tableX;
    for (let i = 0; i < rowValues.length; i += 1) {
      const w = colWidths[i];
      if (i > 0) doc.line(x, y, x, y + rowHeight);
      if (i === 1) {
        let lineY = y + 12;
        for (const lineText of descLines) {
          doc.text(lineText, x + 3, lineY);
          lineY += 9;
        }
      } else {
        doc.text(String(rowValues[i]), x + 3, y + 13);
      }
      x += w;
    }
    y += rowHeight;
  }

  y += 12;
  checkPage(92);
  drawInfoBox(t("section.payment"), [
    `${t("field.form")}: ${textOrDash(invoice.payment.form)}`,
    `${t("field.bank")}: ${textOrDash(invoice.payment.bankName)}`,
    `${t("field.account")}: ${textOrDash(invoice.payment.accountNumber)}`,
    `${t("field.swift")}: ${textOrDash(invoice.payment.swift)}`
  ], page.margin, y, (page.width - page.margin * 2 - 12) / 2, 78);

  drawInfoBox(t("section.annotations"), [
    `${t("field.reverseCharge")}: ${textOrDash(invoice.annotations.reverseCharge)}`
  ], page.margin + (page.width - page.margin * 2 - 12) / 2 + 12, y, (page.width - page.margin * 2 - 12) / 2, 78);

  const vatLegendEntries = usedVatLegendEntries(invoice.items);
  if (vatLegendEntries.length) {
    y += 92;
    const noteLines = doc.splitTextToSize(`${t("vat.legendPrefix")} ${vatLegendEntries.map((entry) => `${entry.code} - ${entry.explanation}`).join(" ")}`, page.width - page.margin * 2);
    checkPage(noteLines.length * 10 + 8);
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(8.5);
    for (const line of noteLines) {
      doc.text(line, page.margin, y);
      y += 10;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(95, 95, 95);
  doc.text(`${t("footer.generated")} ${textOrDash(invoice.meta.generatedAt)} | ${textOrDash(invoice.meta.systemInfo)} | ${textOrDash(currentUploadedFileBaseName)}`, page.margin, page.height - 16);

  doc.save(buildPdfFilename(invoice));
}

function handleDropEvent(event) {
  event.preventDefault();
  dropzone.classList.remove("drag-over");
  const file = event.dataTransfer?.files?.[0];
  loadFile(file);
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
browseBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => loadFile(e.target.files?.[0]));
exportBtn.addEventListener("click", exportPdf);
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("drag-over");
});
dropzone.addEventListener("drop", handleDropEvent);
langSelect.addEventListener("change", () => {
  writeStoredValue(STORAGE_KEYS.language, langSelect.value);
  applyLanguage(langSelect.value);
});
pdfNamePatternSelect?.addEventListener("change", () => {
  writeStoredValue(STORAGE_KEYS.pdfNamePattern, pdfNamePatternSelect.value);
});

const storedPdfNamePattern = readStoredValue(STORAGE_KEYS.pdfNamePattern);
if (hasOptionValue(pdfNamePatternSelect, storedPdfNamePattern)) {
  pdfNamePatternSelect.value = storedPdfNamePattern;
}

const storedLanguage = readStoredValue(STORAGE_KEYS.language);
const initialLanguage = hasOptionValue(langSelect, storedLanguage) ? storedLanguage : "en";
applyLanguage(initialLanguage);
