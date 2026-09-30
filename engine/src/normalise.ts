/**
 * Stage 0 — Normalise & derive.
 *
 * Turns the raw 15-section profile into a single set of monthly-denominated
 * derived figures that every later stage reads from. Pure function, no I/O.
 */

import type { Asset, DerivedFinancials, FinancialProfile, TermCoverNeed } from './types.ts';
import { WATERFALL } from './assumptions/v2026-08.ts';
import { termPremiumMonthly } from './premiums.ts';

const LIQUID_TYPES: Asset['type'][] = ['savings_account', 'cash', 'fixed_deposit', 'recurring_deposit'];

const RETIREMENT_TYPES: Asset['type'][] = ['epf', 'ppf', 'nps', 'sukanya_samriddhi'];

const INVESTED_TYPES: Asset['type'][] = [
  'equity_mutual_fund',
  'debt_mutual_fund',
  'hybrid_mutual_fund',
  'stocks',
  'bonds',
  'gold',
  'reit_invit',
  'crypto',
];

const PHYSICAL_TYPES: Asset['type'][] = [
  'property_self_occupied',
  'property_investment',
  'business_ownership',
];

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function normalise(profile: FinancialProfile): DerivedFinancials {
  const { income, expenses, personal, employment, assets, liabilities, insurance, emergencyFund, dependents } = profile;

  /* ---------------- Income ---------------- */

  // Variable income is a hope, not a salary. Haircut it before planning on it.
  const monthlyVariableRaw = income.annualVariableIncome / 12;
  const variableHaircutApplied = monthlyVariableRaw * WATERFALL.variableIncomeHaircut;
  const monthlyVariablePlannable = monthlyVariableRaw - variableHaircutApplied;

  // Household mode aggregates other earners; individual mode ignores them.
  const otherFamilyIncome = profile.planningMode === 'household' ? income.monthlyOtherFamilyIncome : 0;

  const grossMonthlyIncome = r2(
    income.monthlyTakeHome +
      monthlyVariableRaw +
      income.monthlyBusinessIncome +
      income.monthlyRentalIncome +
      income.annualInterestDividendIncome / 12 +
      otherFamilyIncome +
      income.monthlyOtherIncome,
  );

  const plannableMonthlyIncome = r2(grossMonthlyIncome - variableHaircutApplied);

  /* ---------------- Expenses ---------------- */

  const dependentExtra = sum(
    dependents.map((d) => d.monthlyRequirement + d.monthlyEducationExpense + d.monthlyMedicalExpense),
  );

  const essentialMonthlyExpenses = r2(
    expenses.rentOrHome +
      expenses.foodAndGroceries +
      expenses.utilities +
      expenses.transportation +
      expenses.education +
      expenses.healthcare +
      expenses.insurancePremiums +
      Math.max(expenses.dependentRelated, dependentExtra) +
      expenses.otherRecurring,
  );

  const discretionaryMonthlyExpenses = r2(expenses.lifestyleAndEntertainment + expenses.subscriptions);

  const irregularMonthlyProvision = r2(expenses.annualIrregular / 12);

  const totalMonthlyExpenses = r2(
    essentialMonthlyExpenses + discretionaryMonthlyExpenses + irregularMonthlyProvision,
  );

  /* ---------------- Debt ---------------- */

  const totalMonthlyEMI = r2(sum(liabilities.map((l) => l.monthlyEMI)));
  const totalLiabilities = r2(sum(liabilities.map((l) => l.outstandingAmount)));
  const highCostDebt = r2(
    sum(
      liabilities
        .filter((l) => l.interestRate > WATERFALL.highCostDebtRate)
        .map((l) => l.outstandingAmount),
    ),
  );

  /* ---------------- Surplus ---------------- */

  // Planned on post-haircut income, so a bad bonus year does not break the plan.
  const investableSurplus = r2(plannableMonthlyIncome - totalMonthlyExpenses - totalMonthlyEMI);

  /* ---------------- Assets ---------------- */

  const valueOf = (types: Asset['type'][]) =>
    r2(sum(assets.filter((a) => types.includes(a.type)).map((a) => a.currentValue)));

  const liquidAssets = valueOf(LIQUID_TYPES);
  const retirementAssets = valueOf(RETIREMENT_TYPES);
  const investedAssets = valueOf(INVESTED_TYPES);
  const physicalAssets = valueOf(PHYSICAL_TYPES);
  const otherAssets = r2(
    sum(
      assets
        .filter(
          (a) =>
            !LIQUID_TYPES.includes(a.type) &&
            !RETIREMENT_TYPES.includes(a.type) &&
            !INVESTED_TYPES.includes(a.type) &&
            !PHYSICAL_TYPES.includes(a.type),
        )
        .map((a) => a.currentValue),
    ),
  );

  const totalAssets = r2(liquidAssets + retirementAssets + investedAssets + physicalAssets + otherAssets);
  const netWorth = r2(totalAssets - totalLiabilities);

  /* ---------------- Emergency fund ---------------- */

  const unstable =
    employment.employmentType === 'freelancer' ||
    employment.employmentType === 'business_owner' ||
    employment.employmentType === 'self_employed' ||
    income.incomeStability === 'variable' ||
    employment.jobStability === 'uncertain';

  const highlyUnstable =
    income.incomeStability === 'highly_variable' || employment.jobStability === 'volatile';

  const earnerCount =
    profile.planningMode === 'household' && income.monthlyOtherFamilyIncome > 0 ? 2 : 1;

  // Annotated: WATERFALL is `as const`, so this would otherwise infer the
  // literal type 6 and reject the unstable-income and dependant adjustments.
  let emergencyFundTargetMonths: number = WATERFALL.emergencyMonthsStable;
  if (highlyUnstable) emergencyFundTargetMonths = WATERFALL.emergencyMonthsHighlyUnstable;
  else if (unstable) emergencyFundTargetMonths = WATERFALL.emergencyMonthsUnstable;
  // A single earner supporting dependents needs a deeper buffer.
  if (earnerCount === 1 && dependents.length > 0) emergencyFundTargetMonths += 1;
  if (emergencyFund.desiredMonthsOfCover && emergencyFund.desiredMonthsOfCover > emergencyFundTargetMonths) {
    emergencyFundTargetMonths = emergencyFund.desiredMonthsOfCover;
  }

  const monthlyCommitment = essentialMonthlyExpenses + totalMonthlyEMI;
  const emergencyFundTarget = r2(
    Math.max(
      emergencyFundTargetMonths * monthlyCommitment,
      emergencyFund.preferredTargetAmount ?? 0,
    ),
  );
  const emergencyFundCurrent = r2(Math.max(emergencyFund.currentEmergencySavings, liquidAssets));
  const emergencyFundMonthsCovered = monthlyCommitment > 0 ? r2(emergencyFundCurrent / monthlyCommitment) : 0;

  /* ---------------- Protection ---------------- */

  const hasFinancialDependents =
    dependents.length > 0 ||
    (personal.maritalStatus === 'married' && income.monthlyOtherFamilyIncome === 0);

  const annualIncomeForCover = Math.max(
    income.annualGrossIncome,
    (income.monthlyTakeHome + income.monthlyBusinessIncome) * 12,
  );

  // Human Life Value, simplified: income multiple + liabilities + known future
  // dependent needs, less assets already earmarked. Only if dependents exist.
  const futureDependentNeedsTotal = sum(dependents.map((d) => d.expectedFutureRequirement));
  const alreadyAccumulated = investedAssets + retirementAssets + liquidAssets;

  /* Life cover is sized PER EARNER, not on pooled household income.
     Buying one policy against a combined income understates what each
     person's death would actually cost the family: the survivor keeps their
     own income but loses the other's entirely. */
  const primaryAnnualIncome = Math.max(
    income.annualGrossIncome,
    (income.monthlyTakeHome + income.monthlyBusinessIncome) * 12,
  );

  const earners = [
    {
      id: 'primary',
      name: personal.fullName,
      age: personal.age,
      annualIncome: primaryAnnualIncome,
      existingTermCover: insurance.termLifeCover + insurance.employerProvidedLifeCover,
    },
    ...(profile.planningMode === 'household' ? (profile.additionalEarners ?? []) : []),
  ];

  const totalEarnedIncome = earners.reduce((a, e) => a + e.annualIncome, 0) || 1;

  const multipleFor = (age: number) =>
    age < 35 ? WATERFALL.termCoverMultipleMax : age < 45 ? 12 : WATERFALL.termCoverMultipleMin;

  const termCoverByEarner: TermCoverNeed[] = earners.map((e) => {
    // Liabilities and future dependent needs are shared in proportion to the
    // income each earner contributes — that is the share the family loses.
    const incomeShare = e.annualIncome / totalEarnedIncome;
    const required = hasFinancialDependents
      ? Math.max(
          0,
          e.annualIncome * multipleFor(e.age) +
            (totalLiabilities + futureDependentNeedsTotal - alreadyAccumulated) * incomeShare,
        )
      : 0;
    const gap = Math.max(0, required - e.existingTermCover);
    return {
      earnerId: e.id,
      name: e.name,
      age: e.age,
      annualIncome: r2(e.annualIncome),
      requiredCover: r2(required),
      existingCover: e.existingTermCover,
      gap: r2(gap),
      estimatedMonthlyPremium: termPremiumMonthly(gap, {
        age: e.age,
        gender: e.gender,
        smoker: e.smoker,
      }),
    };
  });

  const requiredTermCover = r2(sum(termCoverByEarner.map((t) => t.requiredCover)));
  const termCoverGap = r2(sum(termCoverByEarner.map((t) => t.gap)));

  const baseHealth =
    personal.cityTier === 'metro'
      ? WATERFALL.healthCoverMetro
      : personal.cityTier === 'tier2'
        ? WATERFALL.healthCoverTier2
        : WATERFALL.healthCoverTier3;

  const parentCount = dependents.filter((d) => d.relationship === 'parent').length;
  const requiredHealthCover = r2(baseHealth + parentCount * WATERFALL.healthCoverPerParent);

  // Employer cover is real but conditional on employment — count it at half weight.
  const effectiveHealthCover =
    insurance.healthCoverSelf +
    insurance.healthCoverFamilyFloater +
    insurance.healthCoverParents +
    insurance.employerProvidedHealthCover * 0.5;

  const healthCoverGap = r2(Math.max(0, requiredHealthCover - effectiveHealthCover));

  return {
    grossMonthlyIncome,
    plannableMonthlyIncome,
    variableIncomeHaircutApplied: r2(variableHaircutApplied),
    essentialMonthlyExpenses,
    discretionaryMonthlyExpenses,
    irregularMonthlyProvision,
    totalMonthlyExpenses,
    totalMonthlyEMI,
    investableSurplus,
    liquidAssets,
    investedAssets,
    retirementAssets,
    physicalAssets,
    totalAssets,
    totalLiabilities,
    highCostDebt,
    netWorth,
    yearsToRetirement: Math.max(0, personal.expectedRetirementAge - personal.age),
    earnerCount,
    hasFinancialDependents,
    emergencyFundTargetMonths,
    emergencyFundTarget,
    emergencyFundCurrent,
    emergencyFundMonthsCovered,
    requiredTermCover,
    termCoverGap,
    termCoverByEarner,
    requiredHealthCover,
    healthCoverGap,
  };
}

export const _internal = { LIQUID_TYPES, RETIREMENT_TYPES, INVESTED_TYPES, PHYSICAL_TYPES, sum, r2 };
