require("dotenv").config();
const fs = require("fs");
const path = require("path");
const supabase = require("../client/sb");
const holding = require("../data/holdings.json");
const filePath = path.join(__dirname, "../data/holdings.json");
const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

function normalize(symbol, date, data) {
  return {
    symbol,
    period_end: date,

    promoter: data.promoter ?? 0,
    fii: data.fii ?? 0,
    mutual_fund: data.mutualFund ?? 0,
    insurance: data.insurance ?? 0,
    banks: data.banks ?? 0,

    retail: data.retail ?? 0,
    hni: data.hni ?? 0,
    nri: data.nri ?? 0,
    corporate: data.corporate ?? 0,
    trust: data.trust ?? 0,
    clearing: data.clearing ?? 0,
    nbfc: data.nbfc ?? 0,
    others: data.others ?? 0,

    individual: data.individual ?? 0,
    institutional: data.institutional ?? 0,
  };
}

async function run() {
  const rows = [];

  for (const symbol of Object.keys(raw)) {
    const periods = raw[symbol];

    for (const date of Object.keys(periods)) {
      rows.push(normalize(symbol, date, periods[date]));
    }
  }

  console.log("Total rows:", rows.length);

  // batch insert (very important — Supabase limit ~500 rows/request)
  const chunkSize = 500;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const { error } = await supabase.from("holdings").upsert(chunk, {
      onConflict: "symbol,period_end",
    });

    if (error) {
      console.error("Insert error:", error);
      return;
    }

    console.log(`Inserted ${i + chunk.length} rows`);
  }

  console.log("DONE");
}

run();
