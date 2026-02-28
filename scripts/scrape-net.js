require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// OPTIONAL (only if you want DB)
let supabase = null;
try {
  supabase = require("../client/sb");
} catch {
  console.log("Supabase disabled — JSON only mode");
}

const BASE_URL =
  "https://www.cdslindia.com/publications/FII/FortnightlySecWisePages/";

/* =========================================================
1) Date generator (CDSL publishes 15th & last day)
========================================================= */
function getAllCdslDates(startYear, endYear) {
  const dates = [];
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 0; month < 12; month++) {
      const fifteenth = new Date(year, month, 15);
      const lastDay = new Date(year, month + 1, 0);
      dates.push(fifteenth);
      dates.push(lastDay);
    }
  }
  return dates;
}

/* =========================================================
2) URL patterns (CDSL uses 4 different filename styles)
========================================================= */
function generateCandidateUrls(date) {
  const month = date.toLocaleString("en-US", { month: "long" });
  const day = date.getDate();
  const year = date.getFullYear();

  const noSpace = `${month}${day}${year}.html`;
  const space = `${month} ${day} ${year}.html`;
  const commaSpace = `${month} ${day}, ${year}.html`;
  const commaNoSpace = `${month} ${day},${year}.html`;

  return [
    BASE_URL + noSpace,
    BASE_URL + encodeURIComponent(space),
    BASE_URL + encodeURIComponent(commaSpace),
    BASE_URL + encodeURIComponent(commaNoSpace),
  ];
}

/* =========================================================
3) Find the working page
========================================================= */
async function fetchWorkingPage(date) {
  const urls = generateCandidateUrls(date);

  for (const url of urls) {
    try {
      console.log("Trying:", url);

      const res = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (
        res.status === 200 &&
        res.data &&
        res.data.includes("Sectors") &&
        res.data.includes("Net Investment")
      ) {
        console.log("FOUND:", url);
        return res.data;
      }
    } catch {}
  }

  console.log("Not Published:", date.toDateString());
  return null;
}

/* =========================================================
4) Detect Net Investment columns
========================================================= */
function findTargetNetInvestmentColumn(headerPaths) {
  const candidates = [];

  headerPaths.forEach((h, i) => {
    const header = h.replace(/\s+/g, " ").trim();

    const isNetInvestment = /Net Investment/i.test(header);
    const isEquityEquity = /> Equity > Equity$/i.test(header);
    const isINR = />\s*IN\s*INR\s*Cr\.?/i.test(header); // KEY FIX

    const periodMatch = header.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December).*?\d{4}/,
    );

    if (isNetInvestment && isEquityEquity && isINR && periodMatch) {
      candidates.push({
        index: i,
        period: periodMatch[0],
        header,
      });
    }
  });

  if (!candidates.length) return null;

  // latest fortnight is always the right-most
  return candidates[candidates.length - 1];
}
function parsePeriodRange(periodText) {
  const match = periodText.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})-(\d{1,2}), (\d{4})/,
  );

  if (!match) return null;

  const [_, monthName, startDay, endDay, year] = match;

  const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();

  // normalize to CDSL settlement cycle
  // 1–15  = first fortnight
  // 16–end = second fortnight

  let period_start, period_end;

  if (Number(endDay) <= 15) {
    // first half
    period_start = new Date(Date.UTC(year, monthIndex, 1));
    period_end = new Date(Date.UTC(year, monthIndex, 15));
  } else {
    // second half
    period_start = new Date(Date.UTC(year, monthIndex, 16));
    period_end = new Date(Date.UTC(year, monthIndex + 1, 0)); // last day of month
  }

  return {
    period_start: period_start.toISOString().slice(0, 10),
    period_end: period_end.toISOString().slice(0, 10),
  };
}
function parseNumber(text) {
  if (!text) return null;

  let t = text.replace(/\u00a0/g, "").trim();

  if (t === "" || t === "--") return null;

  if (/^\(.*\)$/.test(t)) {
    return -parseFloat(t.replace(/[(),]/g, ""));
  }

  return parseFloat(t.replace(/,/g, ""));
}

/* =========================================================
5) Extract table
========================================================= */
async function extractOnePage(date) {
  const html = await fetchWorkingPage(date);
  if (!html) return [];

  const $ = cheerio.load(html);
  const table = $("table").first();
  const rows = table.find("tr");

  const HEADER_ROWS = 4;
  const headerGrid = [];

  /* ---------- Build header grid ---------- */
  for (let r = 0; r < HEADER_ROWS; r++) {
    const row = $(rows[r]);
    const cells = row.find("td");

    headerGrid[r] = [];
    let colIndex = 0;

    cells.each((i, cell) => {
      const colspan = parseInt($(cell).attr("colspan") || "1", 10);
      const text = $(cell).text().replace(/\s+/g, " ").trim();

      for (let k = 0; k < colspan; k++) {
        headerGrid[r][colIndex++] = text;
      }
    });
  }

  /* ---------- Flatten headers ---------- */
  const totalCols = headerGrid[HEADER_ROWS - 1].length;
  const headerPaths = [];

  for (let c = 0; c < totalCols; c++) {
    const path = [];
    for (let r = 0; r < HEADER_ROWS; r++) {
      if (headerGrid[r][c]) path.push(headerGrid[r][c]);
    }
    headerPaths[c] = path.join(" > ");
  }

  /* ---------- Find sector column ---------- */
  const sectorIndex = headerPaths.findIndex((h) => /^Sectors$/i.test(h));
  if (sectorIndex === -1) {
    console.log("Sector column not found");
    return [];
  }

  /* ---------- Find ONLY target Net Investment column ---------- */
  const targetColumn = findTargetNetInvestmentColumn(headerPaths);

  if (!targetColumn) {
    console.log("Target Net Investment column not found");
    return [];
  }

  console.log("Using Column:", targetColumn.period);

  /* ---------- Extract rows ---------- */
  const output = [];

  rows.each((i, row) => {
    if (i < HEADER_ROWS) return;

    const cells = $(row).find("td");
    if (!cells.length) return;

    let sector = $(cells[sectorIndex])
      .text()
      .replace(/\u00a0/g, "")
      .trim();

    if (!sector || sector === "Grand Total") return;

    const raw = $(cells[targetColumn.index]).text();

    const range = parsePeriodRange(targetColumn.period);
    if (!range) return;

    output.push({
      sector,
      period_start: range.period_start,
      period_end: range.period_end,
      net_investment_equity: parseNumber(raw),
    });
  });
  console.log(output);
  return output;
}

/* =========================================================
6) Hash helper
========================================================= */
function hashRow(row) {
  return crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
}
function groupBySector(rows) {
  const result = {};

  for (const row of rows) {
    const { sector, period_start, period_end, net_investment_equity } = row;

    if (!result[sector]) result[sector] = [];

    result[sector].push({
      period_start,
      period_end,
      net_investment_equity,
    });
  }

  // chronological order inside each sector
  for (const s in result) {
    result[s].sort(
      (a, b) => new Date(a.period_start) - new Date(b.period_start),
    );
  }

  return result;
}
async function getLatestPeriodEndFromDB() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("sector_flows_net")
    .select("period_end")
    .order("period_end", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  return new Date(data.period_end);
}
/* =========================================================
7) MAIN
========================================================= */
(async () => {
  const latestDBDate = await getLatestPeriodEndFromDB();
  const today = new Date();
  const dates = getAllCdslDates(today.getFullYear() - 1, today.getFullYear());

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 400);

  const scraped = [];

  for (const date of dates) {
    if (date > today) continue;

    if (latestDBDate && date <= latestDBDate) {
      continue;
    }

    console.log("\nProcessing:", date.toDateString());
    const rows = await extractOnePage(date);
    scraped.push(...rows);
  }

  if (!scraped.length) {
    console.log("No data extracted.");
    return;
  }

  /* ---------- SAVE JSON ---------- */
  const jsonPath = path.join(__dirname, "cdsl_net_investment.json");

  const grouped = groupBySector(scraped);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        sectors: grouped,
      },
      null,
      2,
    ),
  );

  console.log("JSON saved:", jsonPath);

  /* ---------- SUPABASE WRITE ---------- */
  if (!supabase) return;

  console.log("\nWriting to Supabase...");

  const dbRows = scraped
    .filter((r) => r.net_investment_equity !== null)
    .map((r) => ({
      sector: r.sector,
      period_start: r.period_start,
      period_end: r.period_end,
      net_investment_equity: r.net_investment_equity,
      updated_at: new Date().toISOString(),
    }));

  const { data, error } = await supabase
    .from("sector_flows_net")
    .upsert(dbRows, {
      onConflict: "sector,period_end",
      ignoreDuplicates: false,
    });

  if (error) {
    console.error("Supabase error:", error.message);
  } else {
    console.log("Rows processed:", dbRows.length);
  }
})();
