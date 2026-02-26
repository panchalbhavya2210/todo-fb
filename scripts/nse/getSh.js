const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const CATEGORY_MAP = require("../../shareHoldingMapper");

async function getShareholding(xbrlUrl) {
  const xmlRes = await axios.get(xbrlUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/xml,text/xml",
    },
    timeout: 20000,
  });

  const xml = xmlRes.data;

  /* ---------- EXTRACT ISIN ---------- */
  let isin = null;

  function findISIN(node) {
    if (!node || typeof node !== "object") return;

    for (const key in node) {
      const value = node[key];

      // case 1: <ISIN>INE123...</ISIN>
      if (key.toLowerCase().includes("isin")) {
        // string form
        if (typeof value === "string" && value.startsWith("INE")) {
          isin = value.trim();
          return;
        }

        // object form  (this is your case)
        if (value && typeof value === "object" && value["#text"]) {
          const text = value["#text"];
          if (typeof text === "string" && text.startsWith("INE")) {
            isin = text.trim();
            return;
          }
        }
      }

      // recursive search
      if (typeof value === "object") {
        findISIN(value);
        if (isin) return;
      }
    }
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  const json = parser.parse(xml);
  findISIN(json);

  const result = {
    promoter: 0,
    fii: 0,
    mutualFund: 0,
    insurance: 0,
    banks: 0,
    retail: 0,
    hni: 0,
    nri: 0,
    corporate: 0,
    trust: 0,
    clearing: 0,
    nbfc: 0,
    others: 0,
  };

  function scan(node) {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach(scan);
      return;
    }

    if (typeof node !== "object") return;

    for (const key of Object.keys(node)) {
      const value = node[key];

      if (key.includes("ShareholdingAsAPercentageOfTotalNumberOfShares")) {
        const items = Array.isArray(value) ? value : [value];

        items.forEach((item) => {
          if (!item || !item.contextRef || !item["#text"]) return;

          let context = item.contextRef;
          context = context.replace(/_Context.$/, "_ContextI");

          const category = CATEGORY_MAP[context];
          if (!category) return;

          const percent = parseFloat(item["#text"]) * 100;
          result[category] += percent;
        });
      }

      scan(value);
    }
  }

  scan(json);

  Object.keys(result).forEach((k) => {
    result[k] = +result[k].toFixed(2);
  });

  result.individual = +(result.retail + result.hni).toFixed(2);
  result.institutional = +(
    result.fii +
    result.mutualFund +
    result.insurance +
    result.banks
  ).toFixed(2);

  return { isin, holdings: result };
}

module.exports = getShareholding;
