/**
 * Zod schemas mirroring the engine's `FinancialProfile`.
 *
 * One source of truth, used on the client for inline errors and on the server
 * before anything is committed. Never trust the client; never write the rules
 * twice.
 *
 * Rule of thumb applied throughout: only §1 personal, §3 income, §4 expenses,
 * §11 risk and §15 consent are genuinely required. Everything else defaults to
 * zero or empty — the engine handles absence correctly, and a form that demands
 * forty fields before it will do anything gets abandoned.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** Money in whole rupees. Never negative, never a float that drifts. */
const money = z
  .number({ invalid_type_error: 'Enter an amount' })
  .int('Enter a whole rupee amount')
  .min(0, 'Cannot be negative')
  .max(100_000_000_000, 'That looks too large — check the figure');

const rate = z
  .number()
  .min(0, 'Cannot be negative')
  .max(1, 'Enter a decimal, e.g. 0.08 for 8%');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use a valid date');

const fivePoint = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
]);

/* ------------------------------------------------------------------ */
/* §1 Personal                                                         */
/* ------------------------------------------------------------------ */

export const personalSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  age: z.number().int().min(18, 'Must be 18 or over').max(100),
  // Both materially change the term premium we quote — women pay roughly 25%
  // less, smokers 40-60% more. Optional; we assume the dearer case if absent.
  gender: z.enum(['male', 'female', 'other']).optional(),
  smoker: z.boolean().optional(),
  city: z.string().trim().min(1, 'Enter your city').max(80),
  state: z.string().trim().min(1, 'Enter your state').max(80),
  cityTier: z.enum(['metro', 'tier2', 'tier3']),
  maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed']),
  familyMembers: z.number().int().min(1).max(30),
  dependentMembers: z.number().int().min(0).max(30),
  expectedRetirementAge: z.number().int().min(35).max(80),
}).refine((p) => p.expectedRetirementAge > p.age, {
  message: 'Retirement age must be later than your current age',
  path: ['expectedRetirementAge'],
}).refine((p) => p.dependentMembers < p.familyMembers || p.dependentMembers === 0, {
  message: 'Dependants cannot exceed total family members',
  path: ['dependentMembers'],
});

/* ------------------------------------------------------------------ */
/* §2 Employment                                                       */
/* ------------------------------------------------------------------ */

export const employmentSchema = z.object({
  occupation: z.string().trim().min(1, 'Enter your occupation').max(120),
  employmentType: z.enum(['salaried', 'self_employed', 'business_owner', 'freelancer', 'retired']),
  industry: z.string().trim().max(120).default(''),
  yearsOfExperience: z.number().int().min(0).max(60).default(0),
  employerType: z.enum(['private', 'government', 'psu', 'startup', 'business', 'none']),
  jobStability: z.enum(['very_stable', 'stable', 'uncertain', 'volatile']),
  // Drives the step-up SIP. Capped in the engine at 10% regardless.
  expectedIncomeGrowth: rate.default(0.05),
});

/* ------------------------------------------------------------------ */
/* §3 Income                                                           */
/* ------------------------------------------------------------------ */

export const incomeSchema = z.object({
  monthlyTakeHome: money,
  annualGrossIncome: money,
  annualVariableIncome: money.default(0),
  monthlyBusinessIncome: money.default(0),
  monthlyRentalIncome: money.default(0),
  annualInterestDividendIncome: money.default(0),
  monthlyOtherFamilyIncome: money.default(0),
  monthlyOtherIncome: money.default(0),
  incomeFrequency: z.enum(['monthly', 'quarterly', 'irregular']).default('monthly'),
  incomeStability: z.enum(['fixed', 'mostly_fixed', 'variable', 'highly_variable']),
}).refine((i) => i.monthlyTakeHome > 0 || i.monthlyBusinessIncome > 0, {
  message: 'Enter either a monthly take-home salary or business income',
  path: ['monthlyTakeHome'],
});

export const earnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  age: z.number().int().min(18).max(100),
  gender: z.enum(['male', 'female', 'other']).optional(),
  smoker: z.boolean().optional(),
  annualIncome: money,
  existingTermCover: money.default(0),
});

/* ------------------------------------------------------------------ */
/* §4 Expenses                                                         */
/* ------------------------------------------------------------------ */

export const expensesSchema = z.object({
  rentOrHome: money.default(0),
  foodAndGroceries: money,
  utilities: money.default(0),
  transportation: money.default(0),
  education: money.default(0),
  healthcare: money.default(0),
  insurancePremiums: money.default(0),
  lifestyleAndEntertainment: money.default(0),
  subscriptions: money.default(0),
  dependentRelated: money.default(0),
  otherRecurring: money.default(0),
  annualIrregular: money.default(0),
});

/* ------------------------------------------------------------------ */
/* §5 Dependents                                                       */
/* ------------------------------------------------------------------ */

export const dependentSchema = z.object({
  id: z.string().min(1),
  relationship: z.enum(['child', 'spouse', 'parent', 'sibling', 'other']),
  age: z.number().int().min(0).max(120),
  // Needed for Sukanya Samriddhi eligibility. The UI explains why.
  gender: z.enum(['male', 'female', 'other']).optional(),
  monthlyRequirement: money.default(0),
  monthlyEducationExpense: money.default(0),
  monthlyMedicalExpense: money.default(0),
  expectedFutureRequirement: money.default(0),
  yearsOfDependency: z.number().int().min(0).max(80).default(0),
});

/* ------------------------------------------------------------------ */
/* §6 Assets                                                           */
/* ------------------------------------------------------------------ */

export const assetTypeEnum = z.enum([
  'savings_account', 'cash', 'fixed_deposit', 'recurring_deposit',
  'epf', 'ppf', 'nps', 'sukanya_samriddhi',
  'equity_mutual_fund', 'debt_mutual_fund', 'hybrid_mutual_fund',
  'stocks', 'bonds', 'gold',
  'property_self_occupied', 'property_investment', 'reit_invit',
  'business_ownership', 'crypto', 'ulip', 'endowment_policy', 'other',
]);

export const assetSchema = z.object({
  id: z.string().min(1),
  type: assetTypeEnum,
  label: z.string().trim().max(120).optional(),
  amountInvested: money.default(0),
  currentValue: money,
  investmentDate: isoDate,
  monthlyContribution: money.default(0),
  lockInMonthsRemaining: z.number().int().min(0).max(600).default(0),
  maturityDate: isoDate.optional(),
  // Only for ULIP / endowment, so surrender can actually be costed rather than
  // vaguely "reviewed".
  surrenderValue: money.optional(),
  sumAssured: money.optional(),
  remainingPremiumYears: z.number().int().min(0).max(60).optional(),
});

/* ------------------------------------------------------------------ */
/* §7 Liabilities                                                      */
/* ------------------------------------------------------------------ */

export const liabilitySchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'home_loan', 'car_loan', 'personal_loan', 'education_loan', 'gold_loan',
    'business_loan', 'credit_card', 'bnpl', 'family_borrowing', 'other',
  ]),
  outstandingAmount: money,
  interestRate: rate,
  monthlyEMI: money.default(0),
  remainingTenureMonths: z.number().int().min(0).max(480).default(0),
  prepaymentChargeRate: rate.default(0),
  overdueAmount: money.default(0),
});

/* ------------------------------------------------------------------ */
/* §8 Insurance                                                        */
/* ------------------------------------------------------------------ */

export const insuranceSchema = z.object({
  healthCoverSelf: money.default(0),
  healthCoverFamilyFloater: money.default(0),
  healthCoverParents: money.default(0),
  termLifeCover: money.default(0),
  // Asked separately because it counts at half weight — it ends with the job.
  employerProvidedHealthCover: money.default(0),
  employerProvidedLifeCover: money.default(0),
  personalAccidentCover: money.default(0),
  criticalIllnessCover: money.default(0),
  annualPremiumTotal: money.default(0),
  hasInvestmentLinkedPolicy: z.boolean().default(false),
});

/* ------------------------------------------------------------------ */
/* §9 Emergency fund                                                   */
/* ------------------------------------------------------------------ */

export const emergencyFundSchema = z.object({
  currentEmergencySavings: money.default(0),
  preferredTargetAmount: money.optional(),
  desiredMonthsOfCover: z.number().int().min(0).max(36).optional(),
  familyFinancialSupportAvailable: z.boolean().default(false),
  expectedMajorEmergencyExpense: money.default(0),
});

/* ------------------------------------------------------------------ */
/* §10 Goals                                                           */
/* ------------------------------------------------------------------ */

export const goalSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'Give the goal a name').max(120),
  category: z.enum([
    'emergency_fund', 'house_purchase', 'vehicle_purchase', 'marriage',
    'child_education', 'higher_education_self', 'travel', 'business_start',
    'retirement', 'wealth_creation', 'debt_free', 'other',
  ]),
  requiredAmountToday: money,
  targetDate: isoDate,
  amountAlreadySaved: money.default(0),
  monthlyAmountCurrentlyInvested: money.default(0),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  considerInflation: z.boolean().default(true),
  customInflationRate: rate.optional(),
});

/* ------------------------------------------------------------------ */
/* §11 Risk — not skippable; SEBI requires the profiling record        */
/* ------------------------------------------------------------------ */

export const riskSchema = z.object({
  investmentExperience: fivePoint,
  productKnowledge: fivePoint,
  preferredRiskLevel: fivePoint,
  maxAcceptableDrawdown: z.number().min(0).max(0.9),
  reactionToMarketDecline: fivePoint,
  abilityToHandleLosses: fivePoint,
  investmentTimeHorizon: z.number().int().min(0).max(60),
  needForGuaranteedCapital: fivePoint,
  comfortWithVolatility: fivePoint,
});

/* ------------------------------------------------------------------ */
/* §12 Liquidity                                                       */
/* ------------------------------------------------------------------ */

export const liquiditySchema = z.object({
  amountImmediatelyAccessible: money.default(0),
  expectedWithdrawalsNext12Months: money.default(0),
  largeExpensesWithin3Years: money.default(0),
  acceptableLockInMonths: z.number().int().min(0).max(600).default(60),
  withdrawalFrequency: z.enum(['never', 'rare', 'occasional', 'frequent']).default('rare'),
  minimumBankBalancePreference: money.default(0),
});

/* ------------------------------------------------------------------ */
/* §13 Preferences                                                     */
/* ------------------------------------------------------------------ */

const assetClassEnum = z.enum(['equity', 'debt', 'gold', 'real_assets', 'crypto']);

export const preferencesSchema = z.object({
  preferredTypes: z.array(assetClassEnum).default([]),
  avoidTypes: z.array(assetClassEnum).default([]),
  cryptoOptIn: z.boolean().default(false),
  style: z.enum(['active', 'passive', 'no_preference']).default('passive'),
  incomeOrGrowth: z.enum(['regular_income', 'capital_growth', 'balanced']).default('balanced'),
  ethicalPreference: z.boolean().default(false),
  interestedInTaxSaving: z.boolean().default(true),
}).refine((p) => !p.preferredTypes.some((t) => p.avoidTypes.includes(t)), {
  message: 'An asset class cannot be both preferred and avoided',
  path: ['avoidTypes'],
});

/* ------------------------------------------------------------------ */
/* §14 Tax                                                             */
/* ------------------------------------------------------------------ */

export const taxSchema = z.object({
  taxResidency: z.enum(['resident', 'nri', 'rnor']).default('resident'),
  selectedRegime: z.enum(['old', 'new', 'undecided']).default('undecided'),
  annualEPFContribution: money.default(0),
  annualPPFContribution: money.default(0),
  annualNPSContributionSelf: money.default(0),
  annualNPSContributionEmployer: money.default(0),
  annualLifeInsurancePremium: money.default(0),
  annualHealthInsurancePremium: money.default(0),
  annualELSSInvestment: money.default(0),
  annualHomeLoanPrincipalRepaid: money.default(0),
  annualHomeLoanInterestPaid: money.default(0),
  annualChildTuitionFees: money.default(0),
  annualCapitalGainsRealised: money.default(0),
  isSalaried: z.boolean().default(true),
});

/* ------------------------------------------------------------------ */
/* §15 Consent — every flag must be explicit                           */
/* ------------------------------------------------------------------ */

/**
 * The consent text version a user is agreeing to. Server-owned: it identifies
 * which disclosures were on screen, so it can never come from the client.
 */
export const CONSENT_VERSION = 'v1.0';

export const consentSchema = z.object({
  processFinancialInformation: z.literal(true, {
    errorMap: () => ({ message: 'We cannot process your data without this consent' }),
  }),
  generatePersonalisedRecommendations: z.boolean(),
  informationAccurate: z.literal(true, {
    errorMap: () => ({ message: 'Please confirm the information you have given is accurate' }),
  }),
  riskDisclosuresAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Please read and accept the risk disclosures' }),
  }),
  storeRecommendationHistory: z.boolean(),
  remindersAndNotifications: z.boolean(),
  acceptedAt: z.string(),
  consentVersion: z.string(),
  nomineeName: z.string().trim().max(120).optional(),
  emergencyContact: z.string().trim().max(120).optional(),
});

/* ------------------------------------------------------------------ */
/* The whole profile                                                   */
/* ------------------------------------------------------------------ */

export const financialProfileSchema = z.object({
  profileId: z.string().min(1),
  planningMode: z.enum(['individual', 'household']),
  channel: z.object({
    channel: z.enum(['d2c', 'adviser']),
    adviserId: z.string().optional(),
  }),
  personal: personalSchema,
  employment: employmentSchema,
  income: incomeSchema,
  expenses: expensesSchema,
  dependents: z.array(dependentSchema).max(20).default([]),
  assets: z.array(assetSchema).max(100).default([]),
  liabilities: z.array(liabilitySchema).max(50).default([]),
  insurance: insuranceSchema,
  emergencyFund: emergencyFundSchema,
  goals: z.array(goalSchema).max(30).default([]),
  risk: riskSchema,
  liquidity: liquiditySchema,
  preferences: preferencesSchema,
  tax: taxSchema,
  consent: consentSchema,
  additionalEarners: z.array(earnerSchema).max(5).optional(),
}).superRefine((p, ctx) => {
  // Cross-section rules the engine assumes but cannot enforce on its own.

  if (p.planningMode === 'household' && !p.additionalEarners?.length && p.income.monthlyOtherFamilyIncome === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['planningMode'],
      message: 'Household planning needs at least one other earner, or other family income',
    });
  }

  // A goal in the past cannot be planned for.
  const today = new Date().toISOString().slice(0, 10);
  for (const [i, g] of p.goals.entries()) {
    if (g.targetDate <= today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['goals', i, 'targetDate'],
        message: 'Target date must be in the future',
      });
    }
  }

  // Sukanya eligibility depends on this, so an unspecified child is a real gap.
  for (const [i, d] of p.dependents.entries()) {
    if (d.relationship === 'child' && d.age < 10 && !d.gender) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dependents', i, 'gender'],
        message: 'Needed to check Sukanya Samriddhi eligibility — you can select "other" to skip',
      });
    }
  }

  // A ULIP or endowment without its detail cannot be costed, only hand-waved.
  for (const [i, a] of p.assets.entries()) {
    if ((a.type === 'ulip' || a.type === 'endowment_policy') && a.monthlyContribution === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assets', i, 'monthlyContribution'],
        message: 'Enter the premium so we can compare surrendering against continuing',
      });
    }
  }
});

export type ValidatedProfile = z.infer<typeof financialProfileSchema>;

/* ------------------------------------------------------------------ */
/* Per-step schemas, for saving a partial wizard step                   */
/* ------------------------------------------------------------------ */

export const stepSchemas: Record<number, z.ZodTypeAny> = {
  1: z.object({
    planningMode: z.enum(['individual', 'household']),
    personal: personalSchema,
  }),
  2: z.object({
    employment: employmentSchema,
    income: incomeSchema,
    additionalEarners: z.array(earnerSchema).max(5).optional(),
  }),
  /*
   * Step 3 carries a second map alongside the figures: where each one came
   * from. The Spending step opens with an estimate for every category, and a
   * number the client merely failed to disagree with is not client-provided
   * information — so which figures they entered, which they explicitly accepted
   * and which are still ours has to survive the save.
   *
   * Draft-only for now. Carrying it into the committed profile means adding it
   * to `financialProfileSchema` and to the engine's `FinancialProfile`, so that
   * `suitabilityRationale` can say which of the inputs it cites were the
   * client's own. That is the next step, not this one.
   */
  3: z.object({
    expenses: expensesSchema,
    expenseProvenance: z
      .record(z.string(), z.enum(['estimated', 'accepted', 'entered']))
      .optional(),
  }),
  4: z.object({ dependents: z.array(dependentSchema).max(20) }),
  5: z.object({
    assets: z.array(assetSchema).max(100),
    liabilities: z.array(liabilitySchema).max(50),
  }),
  6: z.object({ insurance: insuranceSchema, emergencyFund: emergencyFundSchema }),
  7: z.object({ goals: z.array(goalSchema).max(30), risk: riskSchema }),
  8: z.object({
    liquidity: liquiditySchema,
    preferences: preferencesSchema,
    tax: taxSchema,
    // Stamped here rather than required from the caller. A consent timestamp
    // the user can choose is not evidence of consent, so any client-supplied
    // value is discarded — matching how POST /api/consent records it.
    consent: z.preprocess(
      (v) =>
        typeof v === 'object' && v !== null && !Array.isArray(v)
          ? { ...v, acceptedAt: new Date().toISOString(), consentVersion: CONSENT_VERSION }
          : v,
      consentSchema,
    ),
  }),
};

export const TOTAL_STEPS = 8;

export function validateStep(step: number, data: unknown) {
  const schema = stepSchemas[step];
  if (!schema) return { success: false as const, errors: [`Unknown step ${step}`] };
  const result = schema.safeParse(data);
  return result.success
    ? { success: true as const, data: result.data }
    : {
        success: false as const,
        errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
}
