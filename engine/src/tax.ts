/**
 * Stage 7 — Tax overlay.
 *
 * Computes tax under BOTH regimes with the user's real deductions, recommends
 * the cheaper one with the rupee difference, and reports the 80C / 80D /
 * 80CCD(1B) headroom that the allocation engine then tries to fill with
 * instruments that also serve a goal — rather than pushing insurance products.
 */

import type { DerivedFinancials, FinancialProfile, TaxRecommendation } from './types.ts';
import { NEW_REGIME_SLABS, OLD_REGIME_SLABS, TAX } from './assumptions/v2026-08.ts';
import type { Slab } from './assumptions/v2026-08.ts';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function slabTax(taxableIncome: number, slabs: Slab[]): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    if (taxableIncome <= lower) break;
    const upper = Math.min(taxableIncome, s.upTo);
    tax += (upper - lower) * s.rate;
    lower = s.upTo;
  }
  return tax;
}

/**
 * The rate applied to the NEXT rupee of income — what a slab-taxed capital gain
 * actually costs. Used by the rebalancing module to price a switch honestly
 * rather than quoting gross amounts.
 */
export function marginalRate(
  profile: FinancialProfile,
  derived: DerivedFinancials,
  regime: 'old' | 'new',
): number {
  const grossAnnualIncome = Math.max(
    profile.tax.isSalaried ? profile.income.annualGrossIncome : 0,
    derived.plannableMonthlyIncome * 12,
  );
  const slabs = regime === 'old' ? OLD_REGIME_SLABS : NEW_REGIME_SLABS;
  const standardDeduction =
    profile.tax.isSalaried
      ? regime === 'old'
        ? TAX.oldRegime.standardDeduction
        : TAX.newRegime.standardDeduction
      : 0;

  // Old regime allows deductions to pull the marginal rate down.
  const deductions =
    regime === 'old'
      ? Math.min(
          TAX.limits.section80C,
          profile.tax.annualEPFContribution +
            profile.tax.annualPPFContribution +
            profile.tax.annualELSSInvestment +
            profile.tax.annualLifeInsurancePremium +
            profile.tax.annualHomeLoanPrincipalRepaid,
        ) + Math.min(profile.tax.annualHealthInsurancePremium, TAX.limits.section80D_self)
      : 0;

  const taxable = Math.max(0, grossAnnualIncome - standardDeduction - deductions);
  const slab = slabs.find((s) => taxable <= s.upTo) ?? slabs[slabs.length - 1];
  return slab.rate * (1 + TAX.cess);
}

export function computeTax(profile: FinancialProfile, derived: DerivedFinancials): TaxRecommendation {
  const t = profile.tax;
  const notes: string[] = [];

  const grossBeforeHouseProperty = Math.max(
    t.isSalaried ? profile.income.annualGrossIncome : 0,
    derived.plannableMonthlyIncome * 12,
  );

  /* -------------------- House property -------------------- */
  /* Rent is not taxed at full slab. Section 24(a) gives a flat 30% standard
     deduction on annual value, in BOTH regimes, before any interest. Taxing
     rent gross overstated the bill for every landlord in the book. */
  const annualRent = profile.income.monthlyRentalIncome * 12;
  const housePropertyStandardDeduction = annualRent * TAX.limits.housePropertyStandardDeduction;
  const grossAnnualIncome = Math.max(0, grossBeforeHouseProperty - housePropertyStandardDeduction);

  /* -------------------- 80C -------------------- */
  const eightyCComponents =
    t.annualEPFContribution +
    t.annualPPFContribution +
    t.annualLifeInsurancePremium +
    t.annualELSSInvestment +
    t.annualHomeLoanPrincipalRepaid +
    t.annualChildTuitionFees;
  const section80CUsed = Math.min(eightyCComponents, TAX.limits.section80C);
  const section80CGap = Math.max(0, TAX.limits.section80C - section80CUsed);

  /* -------------------- 80D -------------------- */
  const hasSeniorParents = profile.dependents.some((d) => d.relationship === 'parent' && d.age >= 60);
  const selfLimit =
    profile.personal.age >= 60 ? TAX.limits.section80D_seniorSelf : TAX.limits.section80D_self;
  const parentLimit = hasSeniorParents
    ? TAX.limits.section80D_seniorParents
    : profile.dependents.some((d) => d.relationship === 'parent')
      ? TAX.limits.section80D_parents
      : 0;
  const eightyDLimit = selfLimit + parentLimit;
  const section80DUsed = Math.min(t.annualHealthInsurancePremium, eightyDLimit);
  const section80DGap = Math.max(0, eightyDLimit - section80DUsed);

  /* -------------------- 80CCD(1B) -------------------- */
  const nps80CCD1BUsed = Math.min(t.annualNPSContributionSelf, TAX.limits.section80CCD1B);
  const nps80CCD1BGap = Math.max(0, TAX.limits.section80CCD1B - nps80CCD1BUsed);

  /* -------------------- 80CCD(2) — both regimes -------------------- */
  const employerNPSLimit = grossAnnualIncome * TAX.limits.section80CCD2_salaryShare;
  const employerNPSDeduction = Math.min(t.annualNPSContributionEmployer, employerNPSLimit);

  /* -------------------- Section 24(b) home loan interest -------------------- */
  const homeLoanInterestDeduction = Math.min(t.annualHomeLoanInterestPaid, TAX.limits.section24b);

  /* -------------------- Old regime -------------------- */
  const oldStandardDeduction = t.isSalaried ? TAX.oldRegime.standardDeduction : 0;
  const oldTaxable = Math.max(
    0,
    grossAnnualIncome -
      oldStandardDeduction -
      section80CUsed -
      section80DUsed -
      nps80CCD1BUsed -
      employerNPSDeduction -
      homeLoanInterestDeduction,
  );
  let oldTax = slabTax(oldTaxable, OLD_REGIME_SLABS);
  if (oldTaxable <= TAX.oldRegime.rebateIncomeLimit) {
    oldTax = Math.max(0, oldTax - TAX.oldRegime.rebate87A);
  }
  oldTax = oldTax * (1 + TAX.cess);

  /* -------------------- New regime -------------------- */
  const newStandardDeduction = t.isSalaried ? TAX.newRegime.standardDeduction : 0;
  const newTaxable = Math.max(0, grossAnnualIncome - newStandardDeduction - employerNPSDeduction);
  let newTax = slabTax(newTaxable, NEW_REGIME_SLABS);
  if (newTaxable <= TAX.newRegime.rebateIncomeLimit) {
    newTax = Math.max(0, newTax - TAX.newRegime.rebate87A);
  }
  newTax = newTax * (1 + TAX.cess);

  const recommendedRegime: 'old' | 'new' = oldTax <= newTax ? 'old' : 'new';
  const annualSaving = Math.abs(oldTax - newTax);

  /* -------------------- Notes -------------------- */
  notes.push(
    `On a gross income of ${inr(grossAnnualIncome)}: old regime ${inr(oldTax)}, new regime ${inr(newTax)}. The ${recommendedRegime} regime saves you ${inr(annualSaving)} a year.`,
  );

  if (housePropertyStandardDeduction > 0) {
    notes.push(
      `Your ${inr(annualRent)} of annual rent gets a flat 30% standard deduction under Section 24(a) — ${inr(housePropertyStandardDeduction)} comes off before tax, in either regime, with no receipts required. This applies whether or not you actually spent it on maintenance.`,
    );
  }

  if (recommendedRegime === 'old') {
    if (section80CGap > 0) {
      notes.push(
        `You have ${inr(section80CGap)} of unused 80C headroom. Filling it saves ${inr(section80CGap * 0.3 * (1 + TAX.cess))} at the 30% rate — but only fill it with something you would have invested anyway (ELSS or PPF), not another insurance policy.`,
      );
    }
    if (nps80CCD1BGap > 0) {
      notes.push(
        `${inr(nps80CCD1BGap)} of the ₹50,000 NPS deduction under 80CCD(1B) is unused. Worth taking only if you accept that the money is locked until you turn 60.`,
      );
    }
    if (section80DGap > 0) {
      notes.push(
        `${inr(section80DGap)} of health-insurance premium deduction under 80D is unused. This is the rare deduction where buying the product is a good idea on its own merits.`,
      );
    }
  } else {
    notes.push(
      'On the new regime, 80C, 80D and 80CCD(1B) do not apply — so choose investments on their merits alone, not for tax relief. The one deduction that survives is your employer\'s NPS contribution under 80CCD(2).',
    );
    if (t.annualNPSContributionEmployer === 0 && t.isSalaried) {
      notes.push(
        `Ask your employer whether they offer NPS under 80CCD(2). Up to ${inr(employerNPSLimit)} of employer contribution would be deductible even on the new regime — a rare free lunch.`,
      );
    }
  }

  const ltcgExemptionUnused = Math.max(
    0,
    TAX.capitalGains.equityLTCGExemption - Math.max(0, t.annualCapitalGainsRealised),
  );
  if (ltcgExemptionUnused > 0 && derived.investedAssets > 100_000) {
    notes.push(
      `You have ${inr(ltcgExemptionUnused)} of the annual ₹1.25L equity LTCG exemption unused. Selling and immediately rebuying enough units each year to realise gains up to that limit resets your cost base for free — worth roughly ${inr(ltcgExemptionUnused * TAX.capitalGains.equityLTCGRate)} a year in deferred tax.`,
    );
  }

  if (profile.insurance.hasInvestmentLinkedPolicy) {
    notes.push(
      'You hold an investment-linked insurance policy (ULIP or endowment). These bundle two products that are cheaper bought separately, and the returns are typically 4–6%. Model surrendering it against term insurance plus an index fund before you pay another premium.',
    );
  }

  const highBracket = grossAnnualIncome > 1_600_000;
  if (highBracket) {
    notes.push(
      'In your bracket, debt mutual funds bought after 1 April 2023 are taxed entirely at slab rate — 30% plus cess. Arbitrage funds carry near-identical risk with equity taxation at 12.5% after a year, which is why they appear in your short and medium buckets.',
    );
  }

  return {
    oldRegimeTax: Math.round(oldTax),
    newRegimeTax: Math.round(newTax),
    recommendedRegime,
    annualSaving: Math.round(annualSaving),
    section80CUsed: Math.round(section80CUsed),
    section80CGap: Math.round(section80CGap),
    section80DUsed: Math.round(section80DUsed),
    section80DGap: Math.round(section80DGap),
    nps80CCD1BGap: Math.round(nps80CCD1BGap),
    ltcgExemptionUnused: Math.round(ltcgExemptionUnused),
    notes,
  };
}
