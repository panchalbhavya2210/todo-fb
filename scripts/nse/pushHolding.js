const supabase = require("../../client/sb");

async function pushHolding(symbol, quarter, data) {
  const row = {
    symbol: symbol.trim().toUpperCase(),
    period_end: quarter,

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

  const { error } = await supabase.from("holdings").upsert(row, {
    onConflict: "symbol,period_end",
  });

  if (error) {
    console.error("SUPABASE UPSERT ERROR:", symbol, quarter, error);
  } else {
    console.log("DB UPDATED:", symbol, quarter);
  }
}

module.exports = pushHolding;
