/**
 * FinManAI — domain types
 *
 * Mirrors the 15 sections of the FinManAI requirements document, plus the
 * decisions locked on 18 Aug 2026 (household mode, crypto opt-in, adviser/B2B).
 *
 * All monetary amounts are in INR. Fields named `monthly*` are per month,
 * `annual*` are per year. Anything ambiguous is normalised in normalise.ts.
 */

/* ------------------------------------------------------------------ */
/* §1 Personal                                                         */
/* ------------------------------------------------------------------ */

export type MaritalStatus = 'single' | 'married' | 'divorced' | 'widowed';

export type PersonalDetails = {
  fullName: string;
  age: number;
  /** Materially changes term premium — women pay roughly 25% less. */
  gender?: 'male' | 'female' | 'other';
  /** Smokers pay 40–60% more for term cover. Optional; assumed false. */
  smoker?: boolean;
  city: string;
  state: string;
  cityTier: 'metro' | 'tier2' | 'tier3';
  maritalStatus: MaritalStatus;
  familyMembers: number;
  dependentMembers: number;
  expectedRetirementAge: number;
};

/* ------------------------------------------------------------------ */
/* §2 Employment                                                       */
/* ------------------------------------------------------------------ */

export type EmploymentType =
  | 'salaried'
  | 'self_employed'
  | 'business_owner'
  | 'freelancer'
  | 'retired';

export type EmployerType = 'private' | 'government' | 'psu' | 'startup' | 'business' | 'none';

export type JobStability = 'very_stable' | 'stable' | 'uncertain' | 'volatile';

export type EmploymentDetails = {
  occupation: string;
  employmentType: EmploymentType;
  industry: string;
  yearsOfExperience: number;
  employerType: EmployerType;
  jobStability: JobStability;
  /** Expected nominal income growth, e.g. 0.08 for 8% p.a. */
  expectedIncomeGrowth: number;
};

/* ------------------------------------------------------------------ */
/* §3 Income                                                           */
/* ------------------------------------------------------------------ */

export type IncomeStability = 'fixed' | 'mostly_fixed' | 'variable' | 'highly_variable';

export type IncomeDetails = {
  /** Net take-home, per month */
  monthlyTakeHome: number;
  /** Gross annual (used for tax and term-cover multiples) */
  annualGrossIncome: number;
  /** Bonus / commission / incentives, per year. Haircut applied in normalise. */
  annualVariableIncome: number;
  monthlyBusinessIncome: number;
  monthlyRentalIncome: number;
  annualInterestDividendIncome: number;
  /** Income of other earning family members, per month (household mode) */
  monthlyOtherFamilyIncome: number;
  monthlyOtherIncome: number;
  incomeFrequency: 'monthly' | 'quarterly' | 'irregular';
  incomeStability: IncomeStability;
};

/* ------------------------------------------------------------------ */
/* §4 Expenses                                                         */
/* ------------------------------------------------------------------ */

export type MonthlyExpenses = {
  rentOrHome: number;
  foodAndGroceries: number;
  utilities: number;
  transportation: number;
  education: number;
  healthcare: number;
  insurancePremiums: number;
  lifestyleAndEntertainment: number;
  subscriptions: number;
  dependentRelated: number;
  otherRecurring: number;
  /** Irregular / annual outflows (travel, festivals, maintenance), per year */
  annualIrregular: number;
};

/* ------------------------------------------------------------------ */
/* §5 Dependents                                                       */
/* ------------------------------------------------------------------ */

export type DependentRelationship =
  | 'child'
  | 'spouse'
  | 'parent'
  | 'sibling'
  | 'other';

export type Dependent = {
  id: string;
  relationship: DependentRelationship;
  age: number;
  gender?: 'male' | 'female' | 'other';
  monthlyRequirement: number;
  monthlyEducationExpense: number;
  monthlyMedicalExpense: number;
  /** Known future lump requirement, in today's rupees */
  expectedFutureRequirement: number;
  yearsOfDependency: number;
};

/* ------------------------------------------------------------------ */
/* §6 Assets                                                           */
/* ------------------------------------------------------------------ */

export type AssetType =
  | 'savings_account'
  | 'cash'
  | 'fixed_deposit'
  | 'recurring_deposit'
  | 'epf'
  | 'ppf'
  | 'nps'
  | 'sukanya_samriddhi'
  | 'equity_mutual_fund'
  | 'debt_mutual_fund'
  | 'hybrid_mutual_fund'
  | 'stocks'
  | 'bonds'
  | 'gold'
  | 'property_self_occupied'
  | 'property_investment'
  | 'reit_invit'
  | 'business_ownership'
  | 'crypto'
  | 'ulip'
  | 'endowment_policy'
  | 'other';

export type Asset = {
  id: string;
  type: AssetType;
  label?: string;
  amountInvested: number;
  currentValue: number;
  /** ISO date */
  investmentDate: string;
  monthlyContribution: number;
  /** Remaining lock-in in months, 0 if liquid */
  lockInMonthsRemaining: number;
  maturityDate?: string;
  /* --- Only for ULIP / endowment, so surrender can actually be costed --- */
  /** What the insurer would pay if surrendered today. */
  surrenderValue?: number;
  /** Life cover the policy provides — lost on surrender, must be replaced. */
  sumAssured?: number;
  /** Years of premium still to pay. */
  remainingPremiumYears?: number;
};

/**
 * An income earner. In household mode life cover must be sized per earner —
 * pooling two incomes and buying one policy against the total understates what
 * each person's death would actually cost the family.
 */
export type Earner = {
  id: string;
  name: string;
  age: number;
  gender?: 'male' | 'female' | 'other';
  smoker?: boolean;
  annualIncome: number;
  existingTermCover: number;
};

/* ------------------------------------------------------------------ */
/* §7 Liabilities                                                      */
/* ------------------------------------------------------------------ */

export type LoanType =
  | 'home_loan'
  | 'car_loan'
  | 'personal_loan'
  | 'education_loan'
  | 'gold_loan'
  | 'business_loan'
  | 'credit_card'
  | 'bnpl'
  | 'family_borrowing'
  | 'other';

export type Liability = {
  id: string;
  type: LoanType;
  outstandingAmount: number;
  /** Annual nominal rate, e.g. 0.086 for 8.6% */
  interestRate: number;
  monthlyEMI: number;
  remainingTenureMonths: number;
  /** As a fraction of outstanding, e.g. 0.02 */
  prepaymentChargeRate: number;
  overdueAmount: number;
};

/* ------------------------------------------------------------------ */
/* §8 Insurance                                                        */
/* ------------------------------------------------------------------ */

export type InsuranceDetails = {
  healthCoverSelf: number;
  healthCoverFamilyFloater: number;
  healthCoverParents: number;
  termLifeCover: number;
  employerProvidedHealthCover: number;
  employerProvidedLifeCover: number;
  personalAccidentCover: number;
  criticalIllnessCover: number;
  annualPremiumTotal: number;
  /** Investment-linked policies flagged separately — they are not investments */
  hasInvestmentLinkedPolicy: boolean;
};

/* ------------------------------------------------------------------ */
/* §9 Emergency fund                                                   */
/* ------------------------------------------------------------------ */

export type EmergencyFundPreference = {
  currentEmergencySavings: number;
  /** User's own stated target, if any */
  preferredTargetAmount?: number;
  /** How many months of cover the user wants */
  desiredMonthsOfCover?: number;
  familyFinancialSupportAvailable: boolean;
  expectedMajorEmergencyExpense: number;
};

/* ------------------------------------------------------------------ */
/* §10 Goals                                                           */
/* ------------------------------------------------------------------ */

export type GoalCategory =
  | 'emergency_fund'
  | 'house_purchase'
  | 'vehicle_purchase'
  | 'marriage'
  | 'child_education'
  | 'higher_education_self'
  | 'travel'
  | 'business_start'
  | 'retirement'
  | 'wealth_creation'
  | 'debt_free'
  | 'other';

export type GoalPriority = 'critical' | 'high' | 'medium' | 'low';

export type Goal = {
  id: string;
  name: string;
  category: GoalCategory;
  /** Cost in TODAY's rupees */
  requiredAmountToday: number;
  /** ISO date */
  targetDate: string;
  amountAlreadySaved: number;
  monthlyAmountCurrentlyInvested: number;
  priority: GoalPriority;
  /** Whether the target should be inflated to the target date */
  considerInflation: boolean;
  /** Overseas education etc. — overrides the category default */
  customInflationRate?: number;
};

/* ------------------------------------------------------------------ */
/* §11 Risk profile                                                    */
/* ------------------------------------------------------------------ */

export type FivePoint = 1 | 2 | 3 | 4 | 5;

export type RiskQuestionnaire = {
  /** 1 = none, 5 = extensive */
  investmentExperience: FivePoint;
  productKnowledge: FivePoint;
  /** 1 = capital protection only, 5 = maximum growth */
  preferredRiskLevel: FivePoint;
  /** Maximum temporary loss the user says they can accept, as a fraction: 0.05 → 5% */
  maxAcceptableDrawdown: number;
  /** 1 = sell everything, 5 = invest more */
  reactionToMarketDecline: FivePoint;
  /** 1 = cannot bear any loss, 5 = can absorb large losses */
  abilityToHandleLosses: FivePoint;
  /** Years */
  investmentTimeHorizon: number;
  /** 1 = capital guarantee essential, 5 = not needed at all */
  needForGuaranteedCapital: FivePoint;
  /** 1 = very uncomfortable, 5 = very comfortable */
  comfortWithVolatility: FivePoint;
};

/* ------------------------------------------------------------------ */
/* §12 Liquidity                                                       */
/* ------------------------------------------------------------------ */

export type LiquidityRequirement = {
  amountImmediatelyAccessible: number;
  expectedWithdrawalsNext12Months: number;
  largeExpensesWithin3Years: number;
  acceptableLockInMonths: number;
  withdrawalFrequency: 'never' | 'rare' | 'occasional' | 'frequent';
  minimumBankBalancePreference: number;
};

/* ------------------------------------------------------------------ */
/* §13 Investment preferences                                          */
/* ------------------------------------------------------------------ */

export type AssetClass =
  | 'equity'
  | 'debt'
  | 'gold'
  | 'real_assets'
  | 'crypto';

export type InvestmentPreference = {
  preferredTypes: AssetClass[];
  /** Hard avoid list — honoured by the suitability filter */
  avoidTypes: AssetClass[];
  /** Decision 4: crypto only appears if the user opts in */
  cryptoOptIn: boolean;
  style: 'active' | 'passive' | 'no_preference';
  incomeOrGrowth: 'regular_income' | 'capital_growth' | 'balanced';
  ethicalPreference: boolean;
  interestedInTaxSaving: boolean;
};

/* ------------------------------------------------------------------ */
/* §14 Tax                                                             */
/* ------------------------------------------------------------------ */

export type TaxRegime = 'old' | 'new' | 'undecided';

export type TaxProfile = {
  taxResidency: 'resident' | 'nri' | 'rnor';
  selectedRegime: TaxRegime;
  annualEPFContribution: number;
  annualPPFContribution: number;
  annualNPSContributionSelf: number;
  annualNPSContributionEmployer: number;
  annualLifeInsurancePremium: number;
  annualHealthInsurancePremium: number;
  annualELSSInvestment: number;
  annualHomeLoanPrincipalRepaid: number;
  annualHomeLoanInterestPaid: number;
  annualChildTuitionFees: number;
  annualCapitalGainsRealised: number;
  isSalaried: boolean;
};

/* ------------------------------------------------------------------ */
/* §15 Consent                                                         */
/* ------------------------------------------------------------------ */

export type ConsentRecord = {
  processFinancialInformation: boolean;
  generatePersonalisedRecommendations: boolean;
  informationAccurate: boolean;
  riskDisclosuresAccepted: boolean;
  storeRecommendationHistory: boolean;
  remindersAndNotifications: boolean;
  acceptedAt: string;
  consentVersion: string;
  nomineeName?: string;
  emergencyContact?: string;
};

/* ------------------------------------------------------------------ */
/* Profile envelope                                                    */
/* ------------------------------------------------------------------ */

/** Decision 5 — individual or joint household planning */
export type PlanningMode = 'individual' | 'household';

/** Decision 6 — same engine, both audiences */
export type ChannelContext = {
  channel: 'd2c' | 'adviser';
  adviserId?: string;
};

export type FinancialProfile = {
  profileId: string;
  planningMode: PlanningMode;
  channel: ChannelContext;
  personal: PersonalDetails;
  employment: EmploymentDetails;
  income: IncomeDetails;
  expenses: MonthlyExpenses;
  dependents: Dependent[];
  assets: Asset[];
  liabilities: Liability[];
  insurance: InsuranceDetails;
  emergencyFund: EmergencyFundPreference;
  goals: Goal[];
  risk: RiskQuestionnaire;
  liquidity: LiquidityRequirement;
  preferences: InvestmentPreference;
  tax: TaxProfile;
  consent: ConsentRecord;
  /**
   * Additional earners, used only when planningMode is 'household'. The primary
   * earner is derived from `income` and `personal`.
   */
  additionalEarners?: Earner[];
};

/* ------------------------------------------------------------------ */
/* Engine output                                                       */
/* ------------------------------------------------------------------ */

export type Band = 'critical' | 'poor' | 'fair' | 'good' | 'excellent';

export type Diagnostic = {
  key: string;
  label: string;
  value: number;
  /** 'ratio' | 'months' | 'inr' | 'x' */
  unit: 'ratio' | 'months' | 'inr' | 'multiple';
  benchmark: string;
  band: Band;
  comment: string;
};

export type TermCoverNeed = {
  earnerId: string;
  name: string;
  age: number;
  annualIncome: number;
  requiredCover: number;
  existingCover: number;
  gap: number;
  estimatedMonthlyPremium: number;
};

export type PolicyComparison = {
  assetId: string;
  label: string;
  surrenderValue: number;
  annualPremium: number;
  sumAssured: number;
  remainingYears: number;
  /** Corpus if the policy runs to maturity. */
  valueIfContinued: number;
  /** Corpus if surrendered and redirected, after paying for replacement term cover. */
  valueIfSurrendered: number;
  replacementTermPremiumMonthly: number;
  advantageOfSurrender: number;
  recommendation: 'surrender_and_redirect' | 'continue' | 'too_close_to_call';
  reasoning: string;
};

export type StressTest = {
  key: 'job_loss' | 'market_crash' | 'medical_event';
  title: string;
  scenario: string;
  /** Headline result — months survived, corpus lost, etc. */
  headline: string;
  survivesMonths?: number;
  impactAmount: number;
  severity: 'comfortable' | 'manageable' | 'painful' | 'catastrophic';
  whatBreaks: string;
  mitigation: string;
};

export type DerivedFinancials = {
  grossMonthlyIncome: number;
  plannableMonthlyIncome: number;
  variableIncomeHaircutApplied: number;
  essentialMonthlyExpenses: number;
  discretionaryMonthlyExpenses: number;
  irregularMonthlyProvision: number;
  totalMonthlyExpenses: number;
  totalMonthlyEMI: number;
  investableSurplus: number;
  liquidAssets: number;
  investedAssets: number;
  retirementAssets: number;
  physicalAssets: number;
  totalAssets: number;
  totalLiabilities: number;
  highCostDebt: number;
  netWorth: number;
  yearsToRetirement: number;
  earnerCount: number;
  hasFinancialDependents: boolean;
  emergencyFundTargetMonths: number;
  emergencyFundTarget: number;
  emergencyFundCurrent: number;
  emergencyFundMonthsCovered: number;
  requiredTermCover: number;
  termCoverGap: number;
  /** Per-earner breakdown. One entry in individual mode. */
  termCoverByEarner: TermCoverNeed[];
  requiredHealthCover: number;
  healthCoverGap: number;
};

export type RiskProfile = {
  capacityScore: number;
  toleranceScore: number;
  finalScore: number;
  band: RiskBand;
  equityCeiling: number;
  capacityBreakdown: { factor: string; weight: number; score: number; note: string }[];
  toleranceBreakdown: { factor: string; score: number }[];
  divergenceFlag: boolean;
  divergenceNote?: string;
};

export type RiskBand =
  | 'conservative'
  | 'moderately_conservative'
  | 'balanced'
  | 'moderately_aggressive'
  | 'aggressive';

export type ActionCategory =
  | 'cashflow_repair'
  | 'debt_payoff'
  | 'emergency_fund'
  | 'protection'
  | 'mandatory_contribution'
  | 'near_term_goal'
  | 'tax_efficiency'
  | 'goal_investment'
  | 'wealth_creation'
  | 'debt_prepayment'
  | 'product_review';

export type ActionItem = {
  rank: number;
  category: ActionCategory;
  title: string;
  /** What to commit THIS month. Never a promise about the future. */
  monthlyAmount: number;
  /**
   * What this becomes once temporary commitments end, when that differs.
   * Kept separate from monthlyAmount so a single field is never asked to mean
   * two different things — which is exactly how "invest ₹0 a month now,
   * rising to ₹26,350" got rendered.
   */
  monthlyAmountLater?: number;
  /** Months until monthlyAmountLater applies. */
  startsInMonths?: number;
  /**
   * How much of the household's investable surplus this action consumes now.
   * Differs from monthlyAmount where an existing EMI is being redirected
   * rather than newly found. The sum of these across the plan must never
   * exceed the surplus — an invariant now enforces it.
   */
  surplusConsumed: number;
  oneTimeAmount: number;
  reason: string;
  urgency: 'immediate' | 'this_month' | 'this_quarter' | 'ongoing';
  blocksInvesting: boolean;
};

export type HorizonBucket = 'short' | 'medium' | 'long';

export type Feasibility =
  | 'on_track'
  | 'achievable'
  | 'stretch'
  /** Reachable, but only if the household saves more or allows more time. */
  | 'needs_more_saving'
  /** Out of reach at any plausible contribution — the target itself must change. */
  | 'not_achievable';

/** Retirement is planned as a spending stream, not a single dated payment. */
export type RetirementTranche = {
  label: string;
  /** Share of the retirement corpus spent in this window. */
  weight: number;
  /** Years from today until the midpoint of this spending window. */
  effectiveHorizonYears: number;
  bucket: HorizonBucket;
};

export type GoalPlan = {
  goalId: string;
  name: string;
  category: GoalCategory;
  yearsToTarget: number;
  bucket: HorizonBucket;
  inflationRateUsed: number;
  futureCost: number;
  projectedValueOfExistingSavings: number;
  gap: number;
  expectedReturn: number;
  /**
   * The contribution needed in the FIRST month. Where stepUpRate > 0 this
   * rises each year — see startingMonthlySIP / finalMonthlySIP.
   */
  requiredMonthlySIP: number;
  /** Annual increase assumed in the contribution. 0 means a flat SIP. */
  stepUpRate: number;
  /** What the contribution becomes in the final year, if stepped up. */
  finalMonthlySIP: number;
  /** What a flat SIP would have required — shown so the assumption is visible. */
  flatEquivalentSIP: number;
  currentMonthlySIP: number;
  shortfall: number;
  feasibility: Feasibility;
  allocation: AllocationSlice[];
  /** Present only for retirement goals. */
  decumulation?: RetirementTranche[];
  negotiation?: string;
  note?: string;
};

export type InstrumentCategory = {
  id: string;
  label: string;
  assetClass: AssetClass;
  sleeve: string;
  lockInMonths: number;
  taxNote: string;
  eligibilityNote?: string;
};

export type AllocationSlice = {
  assetClass: AssetClass;
  sleeve: string;
  percent: number;
  monthlyAmount: number;
  instrument: InstrumentCategory;
  rationale: string;
};

export type TaxRecommendation = {
  oldRegimeTax: number;
  newRegimeTax: number;
  recommendedRegime: 'old' | 'new';
  annualSaving: number;
  section80CUsed: number;
  section80CGap: number;
  section80DUsed: number;
  section80DGap: number;
  nps80CCD1BGap: number;
  ltcgExemptionUnused: number;
  notes: string[];
};

export type SuitabilityRecord = {
  subject: string;
  verdict: 'passed' | 'resized' | 'rejected';
  rationale: string;
};

/* ------------------------------------------------------------------ */
/* Rebalancing the EXISTING portfolio                                  */
/*                                                                     */
/* The engine used to direct new money only. For anyone over 40 the    */
/* existing corpus dwarfs the monthly SIP, so advising on the SIP alone */
/* means advising on a fraction of their wealth.                       */
/* ------------------------------------------------------------------ */

export type HoldingLiquidity =
  /** Sellable today. */
  | 'liquid'
  /** Cannot be sold — statutory lock-in (PPF, EPF, NPS, SSY, ELSS in lock-in). */
  | 'locked'
  /** Sellable only in whole, slowly, at high cost (property, business). */
  | 'illiquid'
  /** Not part of the investment portfolio at all (home, emergency fund). */
  | 'excluded';

export type ClassifiedHolding = {
  assetId: string;
  label: string;
  type: AssetType;
  assetClass: AssetClass;
  currentValue: number;
  investedAmount: number;
  unrealisedGain: number;
  holdingMonths: number;
  liquidity: HoldingLiquidity;
  /** Tax due if the whole holding were sold today. */
  taxOnFullExit: number;
  exclusionReason?: string;
};

export type DriftLine = {
  assetClass: AssetClass;
  currentValue: number;
  currentPercent: number;
  targetPercent: number;
  targetValue: number;
  /** Positive = overweight. In percentage points. */
  driftPoints: number;
  action: 'reduce' | 'increase' | 'hold';
  amount: number;
};

export type RebalanceAction = {
  rank: number;
  kind: 'redirect_contributions' | 'switch' | 'hold' | 'flag_illiquid' | 'flag_locked';
  title: string;
  amount: number;
  taxCost: number;
  reason: string;
};

export type RebalancingPlan = {
  /** Value the engine considers rebalanceable. */
  portfolioValue: number;
  excludedValue: number;
  holdings: ClassifiedHolding[];
  current: Record<AssetClass, number>;
  target: Record<AssetClass, number>;
  drift: DriftLine[];
  maxDriftPoints: number;
  needsRebalancing: boolean;
  /** Equity gains that can still be realised this year free of LTCG. */
  taxFreeHeadroom: number;
  /** Tax if the whole drift were closed by selling today. */
  estimatedTaxToRebalanceNow: number;
  /** Months to close the drift using new contributions alone. */
  monthsToCloseWithNewMoney: number;
  actions: RebalanceAction[];
  summary: string;
};

export type RecommendationPlan = {
  profileId: string;
  generatedAt: string;
  engineVersion: string;
  assumptionsVersion: string;
  planningMode: PlanningMode;
  advisoryMode: 'advisory' | 'diagnostic_only';
  derived: DerivedFinancials;
  diagnostics: Diagnostic[];
  riskProfile: RiskProfile;
  actionPlan: ActionItem[];
  goalPlans: GoalPlan[];
  aggregateAllocation: AllocationSlice[];
  taxRecommendation: TaxRecommendation;
  rebalancing: RebalancingPlan;
  policyComparisons: PolicyComparison[];
  stressTests: StressTest[];
  suitability: SuitabilityRecord[];
  warnings: string[];
  disclosures: string[];
};
