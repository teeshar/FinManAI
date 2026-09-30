/**
 * Versioned assumptions — FY 2026-27 / AY 2026-27, effective 18 Aug 2026.
 *
 * Nothing in the engine hardcodes a rate. Every number a recommendation
 * depends on lives here, with a version string that is stamped onto every
 * generated plan so the plan can be reproduced and defended years later.
 *
 * Sources are cited per block. When a source changes (Budget, quarterly small
 * savings notification, RBI), create a NEW file — never edit this one in place.
 */

import type { AssetClass, GoalCategory, HorizonBucket, RiskBand } from '../types.ts';

export const ASSUMPTIONS_VERSION = '2026-08';
export const EFFECTIVE_FROM = '2026-08-18';

/* ------------------------------------------------------------------ */
/* Expected long-run nominal returns (pre-tax, p.a.)                   */
/* Deliberately conservative. These drive every SIP number, so they    */
/* are the single most consequential set of numbers in the product.    */
/* ------------------------------------------------------------------ */

export const EXPECTED_RETURNS = {
  equity_index: 0.11,
  equity_flexicap: 0.115,
  equity_midcap: 0.12,
  equity_smallcap: 0.125,
  equity_international: 0.10,
  elss: 0.115,
  debt_liquid: 0.065,
  debt_arbitrage: 0.068,
  debt_short: 0.072,
  debt_corporate: 0.075,
  debt_target_maturity: 0.072,
  fixed_deposit: 0.068,
  ppf: 0.071,
  epf: 0.0825,
  sukanya: 0.082,
  scss: 0.082,
  nps_equity: 0.11,
  nps_blended: 0.095,
  gold: 0.085,
  reit: 0.09,
  crypto: 0.0, // deliberately zero: we do not forecast returns on speculation
} as const;

/** Blended expected return per asset class, used for goal maths. */
export const ASSET_CLASS_RETURN: Record<AssetClass, number> = {
  equity: 0.113,
  debt: 0.072,
  gold: 0.085,
  real_assets: 0.09,
  crypto: 0.0,
};

/* ------------------------------------------------------------------ */
/* Inflation                                                           */
/* ------------------------------------------------------------------ */

export const GENERAL_INFLATION = 0.06;

export const GOAL_INFLATION: Record<GoalCategory, number> = {
  emergency_fund: 0.06,
  house_purchase: 0.06,
  vehicle_purchase: 0.05,
  marriage: 0.075,
  child_education: 0.10,
  higher_education_self: 0.10,
  travel: 0.06,
  business_start: 0.06,
  retirement: 0.06,
  wealth_creation: 0.06,
  debt_free: 0.0,
  other: 0.06,
};

/* ------------------------------------------------------------------ */
/* Tax — FY 2026-27                                                    */
/* Source: Income tax slab rates, ClearTax (FY 2026-27)                */
/* ------------------------------------------------------------------ */

export type Slab = { upTo: number; rate: number };

export const NEW_REGIME_SLABS: Slab[] = [
  { upTo: 400_000, rate: 0.00 },
  { upTo: 800_000, rate: 0.05 },
  { upTo: 1_200_000, rate: 0.10 },
  { upTo: 1_600_000, rate: 0.15 },
  { upTo: 2_000_000, rate: 0.20 },
  { upTo: 2_400_000, rate: 0.25 },
  { upTo: Infinity, rate: 0.30 },
];

export const OLD_REGIME_SLABS: Slab[] = [
  { upTo: 250_000, rate: 0.00 },
  { upTo: 500_000, rate: 0.05 },
  { upTo: 1_000_000, rate: 0.20 },
  { upTo: Infinity, rate: 0.30 },
];

export const TAX = {
  cess: 0.04,
  newRegime: {
    standardDeduction: 75_000,
    rebate87A: 60_000,
    rebateIncomeLimit: 1_200_000,
  },
  oldRegime: {
    standardDeduction: 50_000,
    rebate87A: 12_500,
    rebateIncomeLimit: 500_000,
  },
  limits: {
    section80C: 150_000,
    section80CCD1B: 50_000,
    section80D_self: 25_000,
    section80D_seniorSelf: 50_000,
    section80D_parents: 25_000,
    section80D_seniorParents: 50_000,
    /** Employer NPS deductible share of salary — available in BOTH regimes */
    section80CCD2_salaryShare: 0.14,
    /** Self-occupied home loan interest, old regime */
    section24b: 200_000,
    /** Section 24(a): flat standard deduction on rental income, both regimes */
    housePropertyStandardDeduction: 0.30,
  },
  capitalGains: {
    equityLTCGRate: 0.125,
    equitySTCGRate: 0.20,
    equityLTCGExemption: 125_000,
    equityLongTermMonths: 12,
    goldLTCGRate: 0.125,
    goldLongTermMonths: 24,
    propertyLTCGRate: 0.125,
    propertyLongTermMonths: 24,
    /** Debt MF bought after 1 Apr 2023: slab rate, no long-term benefit */
    debtMFAtSlab: true,
    cryptoFlatRate: 0.30,
    cryptoLossSetOffAllowed: false,
  },
} as const;

/* ------------------------------------------------------------------ */
/* Small savings — Jul–Sep 2026 quarter (unchanged)                    */
/* ------------------------------------------------------------------ */

export const SMALL_SAVINGS = {
  ppf: 0.071,
  sukanyaSamriddhi: 0.082,
  seniorCitizenSavingsScheme: 0.082,
  ppfLockInYears: 15,
  ppfAnnualMax: 150_000,
  sukanyaMaxChildAge: 10,
  scssMinAge: 60,
} as const;

/* ------------------------------------------------------------------ */
/* Risk banding                                                        */
/* ------------------------------------------------------------------ */

export const RISK_BANDS: { band: RiskBand; min: number; max: number; equityCeiling: number }[] = [
  { band: 'conservative', min: 0, max: 20, equityCeiling: 0.20 },
  { band: 'moderately_conservative', min: 21, max: 40, equityCeiling: 0.40 },
  { band: 'balanced', min: 41, max: 60, equityCeiling: 0.60 },
  { band: 'moderately_aggressive', min: 61, max: 80, equityCeiling: 0.75 },
  { band: 'aggressive', min: 81, max: 100, equityCeiling: 0.90 },
];

/** Divergence between capacity and tolerance beyond this is surfaced to the user. */
export const RISK_DIVERGENCE_THRESHOLD = 20;

/* ------------------------------------------------------------------ */
/* Step-up SIP                                                         */
/*                                                                     */
/* A flat nominal contribution held for 30 years is not how anyone      */
/* actually invests, and modelling it that way told almost every        */
/* household its goals were impossible. Contributions rise with income. */
/* ------------------------------------------------------------------ */

export const STEP_UP = {
  enabled: true,
  /** Never assume a step-up faster than this, whatever the user's stated growth. */
  maxAnnualStepUp: 0.10,
  /** Used when the profile gives no income-growth figure. */
  defaultAnnualStepUp: 0.05,
  /**
   * Only a share of income growth realistically reaches the SIP — lifestyle
   * absorbs the rest. Applied to the user's stated growth before capping.
   */
  shareOfIncomeGrowthSaved: 0.75,
  /** Below this many years, a step-up is not worth modelling. */
  minYearsToApply: 3,
} as const;

/* ------------------------------------------------------------------ */
/* Retirement decumulation                                             */
/*                                                                     */
/* Retirement is not a point in time — it is a 25-year spending stream. */
/* Treating the retirement DATE as the horizon put a 57-year-old's      */
/* entire corpus into short-duration debt, money he will not touch      */
/* until he is 75. Each tranche is horizoned by when it is SPENT.       */
/* ------------------------------------------------------------------ */

export const RETIREMENT = {
  /** Planning age for the end of the drawdown. Not a life expectancy claim. */
  planToAge: 85,
  /**
   * How the corpus is carved up by when each rupee gets spent, measured in
   * years after the retirement date. Weights are derived from the width of
   * each window relative to the whole retirement.
   */
  tranches: [
    { label: 'first 3 years of retirement', fromYear: 0, toYear: 3 },
    { label: 'years 4 to 10 of retirement', fromYear: 3, toYear: 10 },
    { label: 'year 11 onwards', fromYear: 10, toYear: Infinity },
  ],
  /**
   * Sequence-of-returns risk is real: a crash in the first years of
   * retirement does lasting damage because you are selling into it. So the
   * near tranche is deliberately de-risked beyond what its horizon implies.
   */
  nearTrancheEquityCap: 0.10,
} as const;

/* ------------------------------------------------------------------ */
/* Feasibility banding                                                 */
/* ------------------------------------------------------------------ */

export const FEASIBILITY = {
  /** Funded at or above this share of need → 'achievable'. */
  achievable: 0.999,
  /** Funded at or above this → 'stretch'. */
  stretch: 0.6,
  /**
   * Below 'stretch', we distinguish a goal that needs more saving from one
   * that is genuinely out of reach. A goal is impossible when the required
   * contribution exceeds this multiple of total income — no amount of
   * belt-tightening closes it.
   */
  impossibleSIPToIncomeRatio: 0.75,
  /** Extra years we are willing to assume when testing if a goal could close. */
  maxTimelineExtensionYears: 10,
} as const;

/* ------------------------------------------------------------------ */
/* Horizon buckets and base allocation                                 */
/* ------------------------------------------------------------------ */

export const HORIZON_BUCKETS = {
  shortMaxYears: 3,
  mediumMaxYears: 7,
} as const;

/** Base allocation before the risk-band ceiling is applied. Sums to 1. */
export const BASE_ALLOCATION: Record<HorizonBucket, Record<AssetClass, number>> = {
  short: { equity: 0.05, debt: 0.90, gold: 0.05, real_assets: 0.0, crypto: 0.0 },
  medium: { equity: 0.40, debt: 0.52, gold: 0.08, real_assets: 0.0, crypto: 0.0 },
  long: { equity: 0.70, debt: 0.17, gold: 0.08, real_assets: 0.05, crypto: 0.0 },
};

/* ------------------------------------------------------------------ */
/* Hard caps enforced by the suitability filter                        */
/* ------------------------------------------------------------------ */

export const CAPS = {
  goldMax: 0.15,
  goldMin: 0.05,
  realAssetsMax: 0.10,
  cryptoMax: 0.05,
  /** Crypto requires opt-in AND a risk band at or above this */
  cryptoMinRiskBand: 'moderately_aggressive' as RiskBand,
  smallCapShareOfEquity: {
    conservative: 0,
    moderately_conservative: 0,
    balanced: 0.10,
    moderately_aggressive: 0.15,
    aggressive: 0.20,
  } as Record<RiskBand, number>,
  midCapShareOfEquity: {
    conservative: 0,
    moderately_conservative: 0.10,
    balanced: 0.15,
    moderately_aggressive: 0.20,
    aggressive: 0.25,
  } as Record<RiskBand, number>,
  internationalShareOfEquity: 0.15,
} as const;

/* ------------------------------------------------------------------ */
/* Waterfall thresholds                                                */
/* ------------------------------------------------------------------ */

export const WATERFALL = {
  /** Debt above this rate is cleared before any investing happens */
  highCostDebtRate: 0.12,
  /** Debt below this is generally not worth prepaying vs investing */
  lowCostDebtRate: 0.09,
  emergencyMonthsStable: 6,
  emergencyMonthsUnstable: 9,
  emergencyMonthsHighlyUnstable: 12,
  /** Variable income is haircut this much for planning purposes */
  variableIncomeHaircut: 0.50,
  /** Term cover multiple of annual income */
  termCoverMultipleMin: 10,
  termCoverMultipleMax: 15,
  healthCoverMetro: 1_000_000,
  healthCoverTier2: 750_000,
  healthCoverTier3: 500_000,
  healthCoverPerParent: 500_000,
  /** Near-term goals inside this many months must not sit in equity */
  nearTermGoalMonths: 24,
} as const;

/* ------------------------------------------------------------------ */
/* Diagnostic benchmarks                                               */
/* ------------------------------------------------------------------ */

export const BENCHMARKS = {
  savingsRateGood: 0.20,
  savingsRateExcellent: 0.35,
  essentialExpenseRatioMax: 0.50,
  emiToIncomeMax: 0.40,
  nonHomeEmiToIncomeMax: 0.20,
  debtToAssetMax: 0.50,
  liquidityRatioMin: 3,
} as const;

/* ------------------------------------------------------------------ */
/* Affordability model for house purchase (Decision 3)                 */
/* ------------------------------------------------------------------ */

export const PROPERTY = {
  maxEmiToIncome: 0.40,
  minDownPaymentShare: 0.20,
  /** Sanity ceiling: property value should not exceed this multiple of annual income */
  maxValueToAnnualIncome: 5,
  /** Registration, stamp duty, brokerage, interiors as a share of value */
  transactionCostShare: 0.09,
  assumedHomeLoanRate: 0.086,
  assumedTenureYears: 20,
} as const;

/* ------------------------------------------------------------------ */
/* Stress testing                                                      */
/*                                                                     */
/* A plan that only works when nothing goes wrong is not a plan. SEBI   */
/* expects suitability to consider the client's ability to bear loss;   */
/* these make that concrete instead of theoretical.                     */
/* ------------------------------------------------------------------ */

export const STRESS = {
  /** Assumed equity drawdown in a severe bear market. */
  marketCrashEquityFall: 0.35,
  /** Assumed fall in gold and other real assets in the same episode. */
  marketCrashDebtFall: 0.03,
  /** Crypto falls HARDER than equity in a risk-off episode, not softer. */
  marketCrashCryptoFall: 0.55,
  /** Out-of-pocket cost of a serious medical episode in a metro. */
  medicalEventCostMetro: 1_500_000,
  medicalEventCostOther: 1_000_000,
  /** How long a job search realistically takes. */
  jobSearchMonths: 6,
  /** Severance / notice pay assumed. Deliberately zero — many get nothing. */
  assumedSeveranceMonths: 0,
} as const;

/* ------------------------------------------------------------------ */
/* Insurance-linked policy comparison                                  */
/* ------------------------------------------------------------------ */

export const POLICY = {
  /** Realistic net return on a traditional endowment or ULIP after charges. */
  assumedPolicyReturn: 0.05,
  /** What the same money would earn in a diversified index fund. */
  alternativeReturn: 0.11,
  /** Difference below which we refuse to make a recommendation either way. */
  indifferenceBand: 0.05,
} as const;

/* ------------------------------------------------------------------ */
/* Disclosures required on every generated plan                        */
/* ------------------------------------------------------------------ */

export const DISCLOSURES: string[] = [
  'Investments in securities are subject to market risks. Past performance is not indicative of future returns.',
  'This plan is generated from the information you provided. Its accuracy depends entirely on the accuracy and completeness of that information.',
  'Recommendations are made at asset-class and product-category level. No specific scheme, stock or security is being recommended.',
  'Expected returns shown are long-run planning assumptions, not guarantees. Actual returns will differ, in some periods substantially.',
  'FinManAI does not execute transactions on your behalf and does not receive commission from any product manufacturer.',
  `This plan was generated by a deterministic rule-based engine (assumptions version ${ASSUMPTIONS_VERSION}). Where a plain-language explanation accompanies it, that explanation is produced by an AI language model constrained to the engine's output; it introduces no figures or products of its own.`,
  'Your risk profile should be reviewed at least once a year, or sooner if your income, family situation or goals change materially.',
  'Tax treatment depends on your individual circumstances and may change. Please confirm with a qualified tax adviser before acting.',
  'Insurance premium figures are planning estimates based on published Indian market rates as at August 2026. Your actual premium depends on your age at purchase, medical history, occupation and smoking status. Obtain a real quote before acting — for term cover, premiums only ever rise with age.',
];
