const CATEGORY_MAP = {
  /* ---------- PROMOTER ---------- */
  Indian_ContextI: "promoter",
  Foreign_ContextI: "promoter",
  Promoters_ContextI: "promoter",
  PromoterGroup_ContextI: "promoter",
  PromoterAndPromoterGroup_ContextI: "promoter",

  /* ---------- INSTITUTIONAL ---------- */
  InstitutionsForeign_ContextI: "fii",
  MutualFundsOrUTI_ContextI: "mutualFund",
  InsuranceCompanies_ContextI: "insurance",
  Banks_ContextI: "banks",

  /* ---------- INDIVIDUAL ---------- */
  ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakh_ContextI:
    "retail",
  ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakh_ContextI:
    "hni",

  /* ---------- OTHER PUBLIC ---------- */
  NonResidentIndians_ContextI: "nri",
  BodiesCorporate_ContextI: "corporate",
  Trusts_ContextI: "trust",
  ClearingMembers_ContextI: "clearing",
  NonBankingFinancialCompanies_ContextI: "nbfc",
  AnyOther_ContextI: "others",
};

module.exports = CATEGORY_MAP;
