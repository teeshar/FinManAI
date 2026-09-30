/**
 * Stage 6 — Product mapping.
 *
 * Decision 2: recommendations are made at INSTRUMENT CATEGORY level. No scheme
 * names, no stock tickers, no AMC names. That is defensible, works for every
 * income bracket, and keeps the engine free of a data-vendor dependency.
 */

import type {
  AssetClass,
  DerivedFinancials,
  FinancialProfile,
  InstrumentCategory,
  RiskBand,
} from './types.ts';
import { EXPECTED_RETURNS, SMALL_SAVINGS, TAX } from './assumptions/v2026-08.ts';

export const CATALOGUE: Record<string, InstrumentCategory> = {
  /* ---- Equity ---- */
  equity_index_largecap: {
    id: 'equity_index_largecap',
    label: 'Large-cap index fund (Nifty 50 / Nifty 100)',
    assetClass: 'equity',
    sleeve: 'Equity — core',
    lockInMonths: 0,
    taxNote: 'LTCG 12.5% after 12 months, ₹1.25L annual exemption; STCG 20%.',
  },
  equity_index_broad: {
    id: 'equity_index_broad',
    label: 'Broad-market index fund (Nifty 500 / total market)',
    assetClass: 'equity',
    sleeve: 'Equity — core',
    lockInMonths: 0,
    taxNote: 'LTCG 12.5% after 12 months, ₹1.25L annual exemption; STCG 20%.',
  },
  equity_flexicap: {
    id: 'equity_flexicap',
    label: 'Flexi-cap fund',
    assetClass: 'equity',
    sleeve: 'Equity — core',
    lockInMonths: 0,
    taxNote: 'LTCG 12.5% after 12 months; STCG 20%.',
  },
  equity_midcap: {
    id: 'equity_midcap',
    label: 'Mid-cap fund',
    assetClass: 'equity',
    sleeve: 'Equity — satellite',
    lockInMonths: 0,
    taxNote: 'LTCG 12.5% after 12 months; STCG 20%.',
  },
  equity_smallcap: {
    id: 'equity_smallcap',
    label: 'Small-cap fund',
    assetClass: 'equity',
    sleeve: 'Equity — satellite',
    lockInMonths: 0,
    taxNote: 'LTCG 12.5% after 12 months; STCG 20%.',
  },
  equity_international: {
    id: 'equity_international',
    label: 'International / US index fund',
    assetClass: 'equity',
    sleeve: 'Equity — international',
    lockInMonths: 0,
    taxNote: 'Taxed as equity if the fund holds ≥65% domestic equity; otherwise as a non-equity fund at slab rates. Check the scheme category before investing.',
  },
  elss: {
    id: 'elss',
    label: 'ELSS (tax-saving equity fund)',
    assetClass: 'equity',
    sleeve: 'Equity — tax-saving',
    lockInMonths: 36,
    taxNote: '80C deduction up to ₹1.5L (old regime only). 3-year lock-in. LTCG 12.5%.',
    eligibilityNote: 'Only useful if you are on the old tax regime and have 80C headroom.',
  },

  /* ---- Debt ---- */
  debt_liquid: {
    id: 'debt_liquid',
    label: 'Liquid / overnight fund or sweep-in FD',
    assetClass: 'debt',
    sleeve: 'Debt — liquid',
    lockInMonths: 0,
    taxNote: 'Gains taxed at your slab rate. Emergency money belongs here.',
  },
  debt_arbitrage: {
    id: 'debt_arbitrage',
    label: 'Arbitrage fund',
    assetClass: 'debt',
    sleeve: 'Debt — short',
    lockInMonths: 0,
    taxNote: 'Debt-like risk with equity taxation: LTCG 12.5% after 12 months. Efficient for 1–3 year money in the 30% bracket.',
  },
  debt_short: {
    id: 'debt_short',
    label: 'Ultra-short / low-duration debt fund',
    assetClass: 'debt',
    sleeve: 'Debt — short',
    lockInMonths: 0,
    taxNote: 'Taxed at slab rate — no long-term benefit for debt funds bought after 1 Apr 2023.',
  },
  debt_corporate: {
    id: 'debt_corporate',
    label: 'Corporate bond / banking & PSU fund',
    assetClass: 'debt',
    sleeve: 'Debt — medium',
    lockInMonths: 0,
    taxNote: 'Taxed at slab rate.',
  },
  debt_target_maturity: {
    id: 'debt_target_maturity',
    label: 'Target-maturity / gilt fund',
    assetClass: 'debt',
    sleeve: 'Debt — medium',
    lockInMonths: 0,
    taxNote: 'Taxed at slab rate. Holding to maturity gives return visibility.',
  },
  fixed_deposit: {
    id: 'fixed_deposit',
    label: 'Bank fixed / recurring deposit',
    assetClass: 'debt',
    sleeve: 'Debt — guaranteed',
    lockInMonths: 0,
    taxNote: 'Interest taxed at slab rate every year, whether or not you withdraw.',
  },
  ppf: {
    id: 'ppf',
    label: `Public Provident Fund (${(SMALL_SAVINGS.ppf * 100).toFixed(1)}%)`,
    assetClass: 'debt',
    sleeve: 'Debt — sovereign long',
    lockInMonths: SMALL_SAVINGS.ppfLockInYears * 12,
    taxNote: 'Fully tax-free (EEE) and 80C-eligible in the old regime. ₹1.5L per year cap.',
    eligibilityNote: '15-year lock-in — only for goals at least that far away, or retirement.',
  },
  vpf: {
    id: 'vpf',
    label: 'Voluntary Provident Fund (top-up on EPF)',
    assetClass: 'debt',
    sleeve: 'Debt — sovereign long',
    lockInMonths: 0,
    taxNote: 'EPF rate, 80C-eligible in the old regime. Interest on contributions above ₹2.5L a year is taxable.',
    eligibilityNote: 'Salaried employees with an EPF account only.',
  },
  sukanya: {
    id: 'sukanya',
    label: `Sukanya Samriddhi Yojana (${(SMALL_SAVINGS.sukanyaSamriddhi * 100).toFixed(1)}%)`,
    assetClass: 'debt',
    sleeve: 'Debt — sovereign long',
    lockInMonths: 21 * 12,
    taxNote: 'Tax-free (EEE), 80C-eligible in the old regime.',
    eligibilityNote: 'Requires a girl child under 10 years old.',
  },
  scss: {
    id: 'scss',
    label: `Senior Citizens Savings Scheme (${(SMALL_SAVINGS.seniorCitizenSavingsScheme * 100).toFixed(1)}%)`,
    assetClass: 'debt',
    sleeve: 'Debt — guaranteed',
    lockInMonths: 60,
    taxNote: 'Interest taxed at slab rate; quarterly payout.',
    eligibilityNote: 'Age 60 and above.',
  },
  nps: {
    id: 'nps',
    label: 'NPS Tier-I (auto or active choice)',
    assetClass: 'debt',
    sleeve: 'Retirement',
    lockInMonths: 12 * 40,
    taxNote: 'Extra ₹50,000 deduction under 80CCD(1B) in the old regime; employer contribution deductible under 80CCD(2) in BOTH regimes. Locked until 60.',
    eligibilityNote: 'Genuinely locked until retirement — treat it as retirement money only.',
  },

  /* ---- Gold ---- */
  gold_etf: {
    id: 'gold_etf',
    label: 'Gold ETF or gold fund-of-fund',
    assetClass: 'gold',
    sleeve: 'Gold',
    lockInMonths: 0,
    taxNote: 'LTCG 12.5% after 24 months, no indexation; STCG at slab rate.',
    eligibilityNote: 'Sovereign Gold Bonds are no longer being issued — existing SGBs are only available on the secondary market.',
  },

  /* ---- Real assets ---- */
  reit: {
    id: 'reit',
    label: 'Listed REIT / InvIT',
    assetClass: 'real_assets',
    sleeve: 'Real assets',
    lockInMonths: 0,
    taxNote: 'Distributions are taxed by component (interest at slab, dividend often exempt, return of capital deferred). Capital gains as listed securities.',
    eligibilityNote: 'The liquid, divisible way to own real estate — no stamp duty, no tenants, no ₹50L ticket size.',
  },

  /* ---- Speculative ---- */
  crypto: {
    id: 'crypto',
    label: 'Crypto assets (opt-in, hard-capped)',
    assetClass: 'crypto',
    sleeve: 'Speculative',
    lockInMonths: 0,
    taxNote: `Flat ${(TAX.capitalGains.cryptoFlatRate * 100).toFixed(0)}% on gains, 1% TDS on transfers, and losses cannot be set off against anything — not even other crypto gains.`,
    eligibilityNote: 'Outside SEBI regulation. No investor-protection mechanism applies. We assume a 0% expected return for planning: anything you allocate here should be money you can lose entirely.',
  },
};

export type SleeveSplit = { instrumentId: string; share: number; rationale: string };

/**
 * Choose instruments within an asset class for a given horizon and risk band,
 * honouring eligibility and the user's stated style preference.
 */
export function selectInstruments(
  assetClass: AssetClass,
  bucket: 'short' | 'medium' | 'long',
  band: RiskBand,
  profile: FinancialProfile,
  derived: DerivedFinancials,
  caps: { midCapShare: number; smallCapShare: number; internationalShare: number },
  goalLockInMonths: number,
  onOldRegime: boolean,
  eightyCGap: number,
): SleeveSplit[] {
  const passive = profile.preferences.style !== 'active';

  if (assetClass === 'equity') {
    const core = passive ? 'equity_index_broad' : 'equity_flexicap';
    const splits: SleeveSplit[] = [];

    let midShare = bucket === 'short' ? 0 : caps.midCapShare;
    let smallShare = bucket === 'long' ? caps.smallCapShare : 0;
    let intlShare = bucket === 'long' ? caps.internationalShare : 0;

    // ELSS earns its place only if it does two jobs at once: 80C relief AND a
    // long-horizon equity allocation the user needs anyway.
    let elssShare = 0;
    if (onOldRegime && eightyCGap > 0 && goalLockInMonths >= 36 && profile.preferences.interestedInTaxSaving) {
      elssShare = 0.25;
    }

    const coreShare = Math.max(0.3, 1 - midShare - smallShare - intlShare - elssShare);
    const total = coreShare + midShare + smallShare + intlShare + elssShare;

    splits.push({
      instrumentId: core,
      share: coreShare / total,
      rationale: passive
        ? 'A broad index fund is the cheapest, most diversified way to own Indian equity, and it removes fund-manager risk entirely.'
        : 'A flexi-cap fund lets one manager move across market caps, which suits an active preference without concentrating in one segment.',
    });
    if (elssShare > 0)
      splits.push({
        instrumentId: 'elss',
        share: elssShare / total,
        rationale: `You have ₹${Math.round(eightyCGap).toLocaleString('en-IN')} of unused 80C headroom on the old regime, and this goal is more than three years away — so the ELSS lock-in costs you nothing and the deduction is real money back.`,
      });
    if (midShare > 0)
      splits.push({
        instrumentId: 'equity_midcap',
        share: midShare / total,
        rationale: `Mid-caps add return potential above the index. Capped at ${(caps.midCapShare * 100).toFixed(0)}% of equity for your risk band because they fall harder than large-caps.`,
      });
    if (smallShare > 0)
      splits.push({
        instrumentId: 'equity_smallcap',
        share: smallShare / total,
        rationale: `A small satellite position only — small-caps can fall 50–60% and stay down for years, so this is capped at ${(caps.smallCapShare * 100).toFixed(0)}% of equity.`,
      });
    if (intlShare > 0)
      splits.push({
        instrumentId: 'equity_international',
        share: intlShare / total,
        rationale: 'International exposure hedges the risk that your income, your home and your entire portfolio are all denominated in one currency and one economy.',
      });

    return splits;
  }

  if (assetClass === 'debt') {
    const splits: SleeveSplit[] = [];
    const inThirtyPercent = derived.plannableMonthlyIncome * 12 > 1_600_000;

    if (bucket === 'short') {
      splits.push({
        instrumentId: 'debt_liquid',
        share: 0.6,
        rationale: 'Money needed within three years cannot take duration or credit risk. Liquid funds keep it accessible in one working day.',
      });
      splits.push({
        instrumentId: inThirtyPercent ? 'debt_arbitrage' : 'fixed_deposit',
        share: 0.4,
        rationale: inThirtyPercent
          ? 'In the 30% bracket, an arbitrage fund gives near-debt returns with equity taxation (12.5% after a year) instead of losing a third of the interest to slab tax.'
          : 'A fixed deposit gives certainty for a near-term goal, and at your slab rate the tax drag is modest.',
      });
      return splits;
    }

    if (bucket === 'medium') {
      splits.push({
        instrumentId: inThirtyPercent ? 'debt_arbitrage' : 'debt_short',
        share: 0.4,
        rationale: inThirtyPercent
          ? 'Arbitrage funds carry equity taxation, which materially beats slab-taxed debt funds for a 3–7 year holding in your bracket.'
          : 'Short-duration debt funds balance yield against interest-rate risk for a 3–7 year horizon.',
      });
      splits.push({
        instrumentId: 'debt_corporate',
        share: 0.35,
        rationale: 'High-quality corporate bond funds add yield over government paper without stepping into credit risk.',
      });
      splits.push({
        instrumentId: 'debt_target_maturity',
        share: 0.25,
        rationale: 'A target-maturity fund aligned to the goal date gives you visibility on the return you will actually receive.',
      });
      return splits;
    }

    // Long bucket — sovereign, tax-free instruments earn their lock-in here.
    const canUsePPF = goalLockInMonths >= 60;
    const girlChildUnder10 = profile.dependents.some(
      (dep) => dep.relationship === 'child' && dep.gender === 'female' && dep.age < SMALL_SAVINGS.sukanyaMaxChildAge,
    );
    const isSenior = profile.personal.age >= SMALL_SAVINGS.scssMinAge;

    if (isSenior) {
      splits.push({
        instrumentId: 'scss',
        share: 0.5,
        rationale: `At ${(SMALL_SAVINGS.seniorCitizenSavingsScheme * 100).toFixed(1)}% with a government guarantee and quarterly payouts, SCSS is the single best debt instrument available to you.`,
      });
      splits.push({
        instrumentId: 'debt_corporate',
        share: 0.5,
        rationale: 'The balance in high-quality corporate bond funds for liquidity beyond the SCSS limit.',
      });
      return splits;
    }

    if (girlChildUnder10 && canUsePPF) {
      splits.push({
        instrumentId: 'sukanya',
        share: 0.35,
        rationale: `${(SMALL_SAVINGS.sukanyaSamriddhi * 100).toFixed(1)}%, entirely tax-free, and 80C-eligible — the best fixed-income rate available to you, and it is ring-fenced for your daughter.`,
      });
    }
    if (canUsePPF) {
      splits.push({
        instrumentId: 'ppf',
        share: girlChildUnder10 ? 0.3 : 0.45,
        rationale: `${(SMALL_SAVINGS.ppf * 100).toFixed(1)}% tax-free is worth roughly ${(SMALL_SAVINGS.ppf / (1 - 0.3) * 100).toFixed(1)}% pre-tax in the 30% bracket. The 15-year lock-in matches a goal this far away.`,
      });
    }
    splits.push({
      instrumentId: 'debt_corporate',
      share: canUsePPF ? (girlChildUnder10 ? 0.35 : 0.55) : 1.0,
      rationale: 'The liquid portion of the debt sleeve, so the whole allocation is not locked away.',
    });
    const t = splits.reduce((a, s) => a + s.share, 0);
    return splits.map((s) => ({ ...s, share: s.share / t }));
  }

  if (assetClass === 'gold') {
    return [
      {
        instrumentId: 'gold_etf',
        share: 1,
        rationale: 'Gold ETFs track the metal price without storage, purity or making-charge losses. Sovereign Gold Bonds would have been better, but no new tranches are being issued.',
      },
    ];
  }

  if (assetClass === 'real_assets') {
    return [
      {
        instrumentId: 'reit',
        share: 1,
        rationale: 'REITs give commercial real-estate exposure that is liquid, divisible and free of stamp duty — the opposite of buying a flat as an investment.',
      },
    ];
  }

  return [
    {
      instrumentId: 'crypto',
      share: 1,
      rationale: 'You opted in. This is capped hard and modelled at a 0% expected return, because nobody can honestly forecast one.',
    },
  ];
}

export const EXPECTED = EXPECTED_RETURNS;
