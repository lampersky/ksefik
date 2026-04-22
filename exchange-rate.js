const taxPointDateInput = document.getElementById("taxPointDate");
const currencySelect = document.getElementById("currencySelect");
const midValue = document.getElementById("midValue");
const rateMeta = document.getElementById("rateMeta");
const errorBox = document.getElementById("error");

function getNodeTextByName(root, localName) {
  const found = Array.from(root.getElementsByTagName("*")).find((node) => node.localName === localName);
  return found ? found.textContent.trim() : "";
}

function renderError(message) {
  errorBox.textContent = message;
}

function clearError() {
  errorBox.textContent = "";
}

function renderRate(mid, code, currencyName, effectiveDate) {
  midValue.textContent = Number(mid).toFixed(4);
  rateMeta.textContent = `${code} - ${currencyName} - effective date ${effectiveDate}`;
}

function setLoading() {
  midValue.textContent = "...";
  rateMeta.textContent = "Loading latest value from NBP...";
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toPreviousWorkingDay(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() - 1);
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 6) {
    date.setDate(date.getDate() - 1);
  } else if (dayOfWeek === 0) {
    date.setDate(date.getDate() - 2);
  }
  return formatDate(date);
}

async function parseRateResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("json")) {
    const data = await response.json();
    return {
      mid: data?.rates?.[0]?.mid,
      code: data?.code || currencySelect.value,
      currency: data?.currency || "-",
      effectiveDate: data?.rates?.[0]?.effectiveDate || taxPointDateInput.value
    };
  }

  const xmlText = await response.text();
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  return {
    mid: getNodeTextByName(xml, "Mid"),
    code: getNodeTextByName(xml, "Code") || currencySelect.value,
    currency: getNodeTextByName(xml, "Currency") || "-",
    effectiveDate: getNodeTextByName(xml, "EffectiveDate") || taxPointDateInput.value
  };
}

async function fetchRate() {
  const date = taxPointDateInput.value;
  const currency = currencySelect.value;

  if (!date || !currency) {
    renderError("Please choose both tax point date and currency.");
    return;
  }

  clearError();
  setLoading();

  try {
    let queryDate = toPreviousWorkingDay(date);
    let rate = null;
    const maxAttempts = 20;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const endpoint = `https://api.nbp.pl/api/exchangerates/rates/A/${encodeURIComponent(currency)}/${encodeURIComponent(queryDate)}/`;
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json, application/xml;q=0.9, text/xml;q=0.8"
        }
      });

      if (response.ok) {
        rate = await parseRateResponse(response);
        break;
      }

      if (response.status === 404) {
        queryDate = toPreviousWorkingDay(queryDate);
        continue;
      }

      throw new Error(`NBP request failed (${response.status}).`);
    }

    if (!rate) throw new Error("No rate found in recent previous working days.");
    if (!rate.mid) throw new Error("NBP response has no Mid value.");
    renderRate(rate.mid, rate.code, rate.currency, rate.effectiveDate);
  } catch (error) {
    midValue.textContent = "-";
    rateMeta.textContent = "Could not read exchange rate.";
    renderError(error instanceof Error ? error.message : "Unknown error.");
  }
}

function initialize() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  taxPointDateInput.value = `${now.getFullYear()}-${month}-${day}`;

  taxPointDateInput.addEventListener("change", fetchRate);
  currencySelect.addEventListener("change", fetchRate);

  fetchRate();
}

initialize();
