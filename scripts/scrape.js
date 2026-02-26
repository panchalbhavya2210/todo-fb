require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");

const supabase = require("../client/sb");

const BASE_URL =
  "https://www.cdslindia.com/publications/FII/FortnightlySecWisePages/";

const baseAUCName = "AUC as on date > IN INR Cr. > Equity > Equity";

function toSqlDate(human) {
  const [monthName, day, year] = human.replace(",", "").split(" ");

  const monthMap = {
    January: 1,
    February: 2,
    March: 3,
    April: 4,
    May: 5,
    June: 6,
    July: 7,
    August: 8,
    September: 9,
    October: 10,
    November: 11,
    December: 12,
  };

  const m = String(monthMap[monthName]).padStart(2, "0");
  const d = String(day).padStart(2, "0");

  return `${year}-${m}-${d}`;
}

function normalizeSector(sector) {
  return sector.trim().replace(/\s+/g, " ");
}

function hashRow(row) {
  return crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

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
    2) CDSL has multiple filename patterns
    ========================================================= */

function generateCandidateUrls(date) {
  const month = date.toLocaleString("en-US", { month: "long" });
  const day = date.getDate();
  const year = date.getFullYear();

  // 1) Modern format
  const noSpace = `${month}${day}${year}.html`;

  // 2) "October 15 2025.html"
  const space = `${month} ${day} ${year}.html`;

  // 3) "October 15, 2025.html"
  const commaSpace = `${month} ${day}, ${year}.html`;

  // 4) "October 15,2025.html"  ← IMPORTANT (what you found)
  const commaNoSpace = `${month} ${day},${year}.html`;

  return [
    BASE_URL + noSpace,
    BASE_URL + encodeURIComponent(space),
    BASE_URL + encodeURIComponent(commaSpace),
    BASE_URL + encodeURIComponent(commaNoSpace),
  ];
}

/* =========================================================
    3) Create jobs
    ========================================================= */

function formScrapeJobs() {
  const today = new Date();
  const dates = getAllCdslDates(
    new Date().getFullYear() - 1,
    new Date().getFullYear(),
  );

  const jobs = [];

  for (const date of dates) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 400);

    if (date < cutoff) continue;
    if (date > today) continue;

    const humanDate = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    jobs.push({
      date,
      month: humanDate,
      aucName: baseAUCName.replace(/date/i, humanDate),
    });
  }

  return jobs;
}

/* =========================================================
    4) Fetch correct page among multiple patterns
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
        res.data.includes("AUC as on")
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
    5) Extract table
    ========================================================= */

async function extractOnePage(job) {
  try {
    const html = await fetchWorkingPage(job.date);
    if (!html) return [];

    const $ = cheerio.load(html);

    const table = $("table").first();
    const rows = table.find("tr");

    const HEADER_ROWS = 4;
    const headerGrid = [];

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

    const totalCols = headerGrid[HEADER_ROWS - 1].length;

    const headerPaths = [];
    for (let c = 0; c < totalCols; c++) {
      const path = [];
      for (let r = 0; r < HEADER_ROWS; r++) {
        if (headerGrid[r][c]) path.push(headerGrid[r][c]);
      }
      headerPaths[c] = path.join(" > ");
    }

    const targetIndex = headerPaths.indexOf(job.aucName);
    const sectorIndex = headerPaths.indexOf("Sectors");

    if (targetIndex === -1 || sectorIndex === -1) return [];

    const out = [];

    rows.each((i, row) => {
      if (i < HEADER_ROWS) return;

      const cells = $(row).find("td");
      if (!cells.length) return;

      const sector = $(cells[sectorIndex]).text().trim();
      const value = $(cells[targetIndex]).text().trim();

      if (!sector) return;

      out.push({
        sector,
        value,
        month: job.month,
      });
    });

    console.log("Parsed:", job.month);
    return out;
  } catch (err) {
    console.log("Parse error:", job.month);
    return [];
  }
}

/* =========================================================
    6) Main Runner
    ========================================================= */
function parseHumanDate(str) {
  return new Date(str);
}

(async () => {
  const jobs = formScrapeJobs();
  const scraped = [];

  for (const job of jobs) {
    console.log("\nProcessing:", job.month);
    const data = await extractOnePage(job);
    scraped.push(...data);
  }

  /* ===== Pivot ===== */

  const pivot = {};

  for (const row of scraped) {
    if (!pivot[row.sector]) pivot[row.sector] = {};
    pivot[row.sector][row.month] = row.value;
  }

  // collect all statement dates
  const allDates = [...new Set(scraped.map((r) => r.month))]
    .map(parseHumanDate)
    .sort((a, b) => a - b);

  // latest statement = X
  const latestDate = allDates[allDates.length - 1];

  const latestKey = latestDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  console.log("Latest statement:", latestKey);

  // helper to get historical statement
  function getBackDate(indexBack) {
    if (allDates.length - 1 - indexBack < 0) return null;

    const d = allDates[allDates.length - 1 - indexBack];

    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  // clean number
  function toNumber(val) {
    if (!val) return null;
    return parseFloat(val.replace(/,/g, ""));
  }

  // mapping days → number of statements back
  const periods = {
    "15D": 1,
    "30D": 2,
    "90D": 6,
    "180D": 12,
    "360D": 24,
  };

  const rollingRows = [];

  for (const sector of Object.keys(pivot)) {
    // find latest available date for this sector
    const sectorDates = Object.keys(pivot[sector])
      .map(parseHumanDate)
      .sort((a, b) => a - b);

    if (sectorDates.length === 0) continue;

    const sectorLatestDate = sectorDates[sectorDates.length - 1];

    const sectorLatestKey = sectorLatestDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const latestVal = toNumber(pivot[sector][sectorLatestKey]);
    if (latestVal == null) continue;

    const row = { Sector: sector };

    for (const label in periods) {
      const idx = allDates.findIndex(
        (d) => d.getTime() === sectorLatestDate.getTime(),
      );

      const backDate = allDates[idx - periods[label]];
      if (!backDate) {
        row[label] = "";
        continue;
      }

      const backKey = backDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      if (!backKey || !pivot[sector][backKey]) {
        row[label] = "";
        continue;
      }

      const oldVal = toNumber(pivot[sector][backKey]);

      if (oldVal == null) {
        row[label] = "";
        continue;
      }

      // X - historical
      row[label] = +(latestVal - oldVal).toFixed(2);
    }

    rollingRows.push(row);
  }

  if (rollingRows.length < 10) {
    console.log("CDSL page likely not published or blocked. Aborting.");
    process.exit(0);
  }
  const statementDate = toSqlDate(latestKey);

  const dbRows = rollingRows.map((r) => {
    const sector = normalizeSector(r.Sector);

    const payload = {
      statement_date: statementDate,
      sector: sector,
      d15: r["15D"] ?? null,
      d30: r["30D"] ?? null,
      d90: r["90D"] ?? null,
      d180: r["180D"] ?? null,
      d360: r["360D"] ?? null,
    };

    return {
      ...payload,
      data_hash: hashRow(payload),
    };
  });

  const { data: existing, error: fetchError } = await supabase
    .from("cdsl_fii_sector_rolling")
    .select("sector, data_hash")
    .eq("statement_date", statementDate);

  if (fetchError) {
    console.error("Fetch error:", fetchError);
    process.exit(1);
  }

  const existingMap = new Map(
    (existing || []).map((r) => [r.sector, r.data_hash]),
  );

  const rowsToUpsert = dbRows.filter((row) => {
    const oldHash = existingMap.get(row.sector);
    return oldHash !== row.data_hash;
  });

  if (rowsToUpsert.length === 0) {
    console.log("No change in CDSL data. Skipping DB update.");
    return;
  }

  const { error: upsertError } = await supabase
    .from("cdsl_fii_sector_rolling")
    .upsert(rowsToUpsert, {
      onConflict: "statement_date,sector",
    });

  if (upsertError) {
    console.error("Upsert error:", upsertError);
    process.exit(1);
  }

  console.log("Rows inserted/updated:", rowsToUpsert.length);

  const output = {
    lastUpdated: new Date().toISOString(),
    latestStatement: latestKey,
    sectors: rollingRows,
  };
})();
