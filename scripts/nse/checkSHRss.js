const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const path = require("path");
const getShareholding = require("./getSh");

const companies = require("../../data/companies.json");

/* ---------- BUILD ISIN → SYMBOL MAP ---------- */
const isinToSymbol = {};
for (const sym in companies) {
  isinToSymbol[companies[sym].isin] = sym;
}

/* ---------- PATHS ---------- */
const holdingsPath = path.join(__dirname, "../../data/holdings.json");
const seenPath = path.join(__dirname, "../../data/seen.json");

/* ---------- HELPERS ---------- */

function loadJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeDate(dateStr) {
  const months = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };

  const [day, mon, year] = dateStr.split("-");
  return `${year}-${months[mon]}-${day}`;
}

/* ---------- RSS ---------- */

const RSS =
  "https://nsearchives.nseindia.com/content/RSS/Shareholding_Pattern.xml";
const parser = new XMLParser();

async function checkRSS() {
  const seen = new Set(loadJSON(seenPath, []));
  const holdingsDB = loadJSON(holdingsPath, {});

  const xml = await axios.get(RSS, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 20000,
  });

  const feed = parser.parse(xml.data);

  let items = feed.rss.channel.item;
  if (!Array.isArray(items)) items = [items];

  for (const item of items) {
    const link = item.link;
    if (seen.has(link)) continue;

    console.log("NEW FILING:", link);

    const desc = item.description;
    const match = desc.match(/AS ON DATE\s*:\s*(\d{2}-[A-Za-z]{3}-\d{4})/i);
    if (!match) continue;

    const quarter = normalizeDate(match[1]);

    /* ---------- PARSE SHAREHOLDING ---------- */
    const { isin, holdings } = await getShareholding(link);

    const symbol = isinToSymbol[isin];
    if (!symbol) {
      console.log("UNKNOWN ISIN:", isin);
      continue;
    }

    /* ---------- UPSERT ---------- */
    holdingsDB[symbol] ??= {};

    if (holdingsDB[symbol][quarter]) console.log("REVISION:", symbol, quarter);
    else console.log("NEW:", symbol, quarter);

    holdingsDB[symbol][quarter] = holdings;

    saveJSON(holdingsPath, holdingsDB);

    seen.add(link);

    /* avoid NSE throttle */
    await new Promise((r) => setTimeout(r, 1000));
  }

  saveJSON(seenPath, [...seen]);
}

checkRSS();
