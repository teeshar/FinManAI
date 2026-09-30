/**
 * Realistic test personas.
 *
 * These are the regression suite. Any engine change that moves a number for
 * one of these households must be an explicit, reviewed diff — that is the
 * closest thing software has to a correctness proof for financial advice.
 */

import type { FinancialProfile } from '../src/types.ts';

const baseConsent = {
  processFinancialInformation: true,
  generatePersonalisedRecommendations: true,
  informationAccurate: true,
  riskDisclosuresAccepted: true,
  storeRecommendationHistory: true,
  remindersAndNotifications: true,
  acceptedAt: '2026-08-18T00:00:00Z',
  consentVersion: 'v1.0',
};

function base(overrides: Partial<FinancialProfile>): FinancialProfile {
  const profile: FinancialProfile = {
    profileId: 'p_base',
    planningMode: 'individual',
    channel: { channel: 'd2c' },
    personal: {
      fullName: 'Test User',
      age: 30,
      city: 'Pune',
      state: 'Maharashtra',
      cityTier: 'metro',
      maritalStatus: 'single',
      familyMembers: 1,
      dependentMembers: 0,
      expectedRetirementAge: 60,
    },
    employment: {
      occupation: 'Engineer',
      employmentType: 'salaried',
      industry: 'IT',
      yearsOfExperience: 7,
      employerType: 'private',
      jobStability: 'stable',
      expectedIncomeGrowth: 0.08,
    },
    income: {
      monthlyTakeHome: 80_000,
      annualGrossIncome: 1_400_000,
      annualVariableIncome: 0,
      monthlyBusinessIncome: 0,
      monthlyRentalIncome: 0,
      annualInterestDividendIncome: 0,
      monthlyOtherFamilyIncome: 0,
      monthlyOtherIncome: 0,
      incomeFrequency: 'monthly',
      incomeStability: 'fixed',
    },
    expenses: {
      rentOrHome: 20_000,
      foodAndGroceries: 10_000,
      utilities: 3_000,
      transportation: 4_000,
      education: 0,
      healthcare: 1_500,
      insurancePremiums: 0,
      lifestyleAndEntertainment: 6_000,
      subscriptions: 1_500,
      dependentRelated: 0,
      otherRecurring: 2_000,
      annualIrregular: 60_000,
    },
    dependents: [],
    assets: [],
    liabilities: [],
    insurance: {
      healthCoverSelf: 0,
      healthCoverFamilyFloater: 0,
      healthCoverParents: 0,
      termLifeCover: 0,
      employerProvidedHealthCover: 300_000,
      employerProvidedLifeCover: 0,
      personalAccidentCover: 0,
      criticalIllnessCover: 0,
      annualPremiumTotal: 0,
      hasInvestmentLinkedPolicy: false,
    },
    emergencyFund: {
      currentEmergencySavings: 0,
      familyFinancialSupportAvailable: false,
      expectedMajorEmergencyExpense: 0,
    },
    goals: [],
    risk: {
      investmentExperience: 3,
      productKnowledge: 3,
      preferredRiskLevel: 3,
      maxAcceptableDrawdown: 0.20,
      reactionToMarketDecline: 3,
      abilityToHandleLosses: 3,
      investmentTimeHorizon: 10,
      needForGuaranteedCapital: 3,
      comfortWithVolatility: 3,
    },
    liquidity: {
      amountImmediatelyAccessible: 100_000,
      expectedWithdrawalsNext12Months: 0,
      largeExpensesWithin3Years: 0,
      acceptableLockInMonths: 60,
      withdrawalFrequency: 'rare',
      minimumBankBalancePreference: 50_000,
    },
    preferences: {
      preferredTypes: ['equity', 'debt', 'gold'],
      avoidTypes: [],
      cryptoOptIn: false,
      style: 'passive',
      incomeOrGrowth: 'capital_growth',
      ethicalPreference: false,
      interestedInTaxSaving: true,
    },
    tax: {
      taxResidency: 'resident',
      selectedRegime: 'undecided',
      annualEPFContribution: 0,
      annualPPFContribution: 0,
      annualNPSContributionSelf: 0,
      annualNPSContributionEmployer: 0,
      annualLifeInsurancePremium: 0,
      annualHealthInsurancePremium: 0,
      annualELSSInvestment: 0,
      annualHomeLoanPrincipalRepaid: 0,
      annualHomeLoanInterestPaid: 0,
      annualChildTuitionFees: 0,
      annualCapitalGainsRealised: 0,
      isSalaried: true,
    },
    consent: baseConsent,
  };
  return { ...profile, ...overrides } as FinancialProfile;
}

/* ------------------------------------------------------------------ */
/* 1. Rohan — the worked example from the design document              */
/* ------------------------------------------------------------------ */

export const rohan: FinancialProfile = base({
  profileId: 'rohan_29_pune',
  personal: {
    fullName: 'Rohan Deshpande',
    age: 29,
    city: 'Pune',
    state: 'Maharashtra',
    cityTier: 'metro',
    maritalStatus: 'married',
    familyMembers: 2,
    dependentMembers: 1,
    expectedRetirementAge: 58,
  },
  income: {
    monthlyTakeHome: 95_000,
    annualGrossIncome: 1_600_000,
    annualVariableIncome: 150_000,
    monthlyBusinessIncome: 0,
    monthlyRentalIncome: 0,
    annualInterestDividendIncome: 12_000,
    monthlyOtherFamilyIncome: 0,
    monthlyOtherIncome: 0,
    incomeFrequency: 'monthly',
    incomeStability: 'fixed',
  },
  expenses: {
    rentOrHome: 6_000,
    foodAndGroceries: 14_000,
    utilities: 4_000,
    transportation: 6_000,
    education: 0,
    healthcare: 2_000,
    insurancePremiums: 4_000,
    lifestyleAndEntertainment: 8_000,
    subscriptions: 1_500,
    dependentRelated: 0,
    otherRecurring: 5_000,
    annualIrregular: 66_000,
  },
  assets: [
    { id: 'a1', type: 'savings_account', amountInvested: 140_000, currentValue: 140_000, investmentDate: '2024-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a2', type: 'fixed_deposit', amountInvested: 200_000, currentValue: 200_000, investmentDate: '2024-06-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a3', type: 'epf', amountInvested: 380_000, currentValue: 420_000, investmentDate: '2019-07-01', monthlyContribution: 7_200, lockInMonthsRemaining: 0 },
    { id: 'a4', type: 'ulip', label: 'ULIP (3 years in)', amountInvested: 144_000, currentValue: 138_000, investmentDate: '2023-08-01', monthlyContribution: 4_000, lockInMonthsRemaining: 24, surrenderValue: 118_000, sumAssured: 500_000, remainingPremiumYears: 12 },
    { id: 'a5', type: 'property_self_occupied', amountInvested: 4_200_000, currentValue: 4_800_000, investmentDate: '2022-03-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
  ],
  liabilities: [
    { id: 'l1', type: 'home_loan', outstandingAmount: 2_800_000, interestRate: 0.086, monthlyEMI: 18_000, remainingTenureMonths: 228, prepaymentChargeRate: 0, overdueAmount: 0 },
    { id: 'l2', type: 'credit_card', outstandingAmount: 85_000, interestRate: 0.42, monthlyEMI: 4_500, remainingTenureMonths: 24, prepaymentChargeRate: 0, overdueAmount: 0 },
  ],
  insurance: {
    healthCoverSelf: 0,
    healthCoverFamilyFloater: 0,
    healthCoverParents: 0,
    termLifeCover: 0,
    employerProvidedHealthCover: 300_000,
    employerProvidedLifeCover: 0,
    personalAccidentCover: 0,
    criticalIllnessCover: 0,
    annualPremiumTotal: 48_000,
    hasInvestmentLinkedPolicy: true,
  },
  emergencyFund: { currentEmergencySavings: 340_000, familyFinancialSupportAvailable: true, expectedMajorEmergencyExpense: 0 },
  goals: [
    { id: 'g1', name: 'Car', category: 'vehicle_purchase', requiredAmountToday: 900_000, targetDate: '2029-08-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'medium', considerInflation: true },
    { id: 'g2', name: "Child's education", category: 'child_education', requiredAmountToday: 2_500_000, targetDate: '2034-06-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'high', considerInflation: true },
    { id: 'g3', name: 'Retirement', category: 'retirement', requiredAmountToday: 25_000_000, targetDate: '2055-04-01', amountAlreadySaved: 420_000, monthlyAmountCurrentlyInvested: 7_200, priority: 'high', considerInflation: true },
  ],
  risk: {
    investmentExperience: 3,
    productKnowledge: 3,
    preferredRiskLevel: 4,
    maxAcceptableDrawdown: 0.30,
    reactionToMarketDecline: 4,
    abilityToHandleLosses: 4,
    investmentTimeHorizon: 20,
    needForGuaranteedCapital: 4,
    comfortWithVolatility: 4,
  },
  tax: {
    taxResidency: 'resident',
    selectedRegime: 'undecided',
    annualEPFContribution: 86_400,
    annualPPFContribution: 0,
    annualNPSContributionSelf: 0,
    annualNPSContributionEmployer: 0,
    annualLifeInsurancePremium: 48_000,
    annualHealthInsurancePremium: 0,
    annualELSSInvestment: 0,
    annualHomeLoanPrincipalRepaid: 62_000,
    annualHomeLoanInterestPaid: 236_000,
    annualChildTuitionFees: 0,
    annualCapitalGainsRealised: 0,
    isSalaried: true,
  },
});

/* ------------------------------------------------------------------ */
/* 2. Deficit household — the case that must NOT get a SIP             */
/* ------------------------------------------------------------------ */

export const deficitHousehold: FinancialProfile = base({
  profileId: 'meena_38_deficit',
  personal: { fullName: 'Meena Kulkarni', age: 38, city: 'Nagpur', state: 'Maharashtra', cityTier: 'tier2', maritalStatus: 'married', familyMembers: 4, dependentMembers: 3, expectedRetirementAge: 60 },
  employment: { occupation: 'Shop owner', employmentType: 'business_owner', industry: 'Retail', yearsOfExperience: 12, employerType: 'business', jobStability: 'uncertain', expectedIncomeGrowth: 0.04 },
  income: { monthlyTakeHome: 0, annualGrossIncome: 540_000, annualVariableIncome: 0, monthlyBusinessIncome: 45_000, monthlyRentalIncome: 0, annualInterestDividendIncome: 0, monthlyOtherFamilyIncome: 0, monthlyOtherIncome: 0, incomeFrequency: 'irregular', incomeStability: 'highly_variable' },
  expenses: { rentOrHome: 14_000, foodAndGroceries: 12_000, utilities: 3_500, transportation: 3_000, education: 8_000, healthcare: 2_500, insurancePremiums: 1_800, lifestyleAndEntertainment: 3_000, subscriptions: 800, dependentRelated: 2_000, otherRecurring: 2_500, annualIrregular: 48_000 },
  dependents: [
    { id: 'd1', relationship: 'child', age: 12, gender: 'female', monthlyRequirement: 3_000, monthlyEducationExpense: 5_000, monthlyMedicalExpense: 0, expectedFutureRequirement: 1_500_000, yearsOfDependency: 12 },
    { id: 'd2', relationship: 'child', age: 8, gender: 'male', monthlyRequirement: 2_500, monthlyEducationExpense: 3_000, monthlyMedicalExpense: 0, expectedFutureRequirement: 1_500_000, yearsOfDependency: 16 },
    { id: 'd3', relationship: 'parent', age: 66, monthlyRequirement: 3_000, monthlyEducationExpense: 0, monthlyMedicalExpense: 2_000, expectedFutureRequirement: 0, yearsOfDependency: 15 },
  ],
  liabilities: [
    { id: 'l1', type: 'business_loan', outstandingAmount: 600_000, interestRate: 0.145, monthlyEMI: 14_500, remainingTenureMonths: 48, prepaymentChargeRate: 0.02, overdueAmount: 0 },
    { id: 'l2', type: 'personal_loan', outstandingAmount: 250_000, interestRate: 0.165, monthlyEMI: 8_800, remainingTenureMonths: 33, prepaymentChargeRate: 0.03, overdueAmount: 0 },
  ],
  emergencyFund: { currentEmergencySavings: 25_000, familyFinancialSupportAvailable: false, expectedMajorEmergencyExpense: 100_000 },
  goals: [
    { id: 'g1', name: "Daughter's education", category: 'child_education', requiredAmountToday: 1_500_000, targetDate: '2032-06-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'critical', considerInflation: true },
  ],
  risk: { investmentExperience: 1, productKnowledge: 1, preferredRiskLevel: 2, maxAcceptableDrawdown: 0.05, reactionToMarketDecline: 2, abilityToHandleLosses: 1, investmentTimeHorizon: 6, needForGuaranteedCapital: 1, comfortWithVolatility: 1 },
  tax: { taxResidency: 'resident', selectedRegime: 'new', annualEPFContribution: 0, annualPPFContribution: 0, annualNPSContributionSelf: 0, annualNPSContributionEmployer: 0, annualLifeInsurancePremium: 21_600, annualHealthInsurancePremium: 0, annualELSSInvestment: 0, annualHomeLoanPrincipalRepaid: 0, annualHomeLoanInterestPaid: 0, annualChildTuitionFees: 0, annualCapitalGainsRealised: 0, isSalaried: false },
});

/* ------------------------------------------------------------------ */
/* 3. Young first-jobber — long horizon, no dependents, crypto opt-in  */
/* ------------------------------------------------------------------ */

export const firstJob: FinancialProfile = base({
  profileId: 'aditi_23_firstjob',
  personal: { fullName: 'Aditi Sharma', age: 23, city: 'Bengaluru', state: 'Karnataka', cityTier: 'metro', maritalStatus: 'single', familyMembers: 1, dependentMembers: 0, expectedRetirementAge: 55 },
  employment: { occupation: 'Software engineer', employmentType: 'salaried', industry: 'IT', yearsOfExperience: 1, employerType: 'startup', jobStability: 'stable', expectedIncomeGrowth: 0.15 },
  income: { monthlyTakeHome: 68_000, annualGrossIncome: 950_000, annualVariableIncome: 80_000, monthlyBusinessIncome: 0, monthlyRentalIncome: 0, annualInterestDividendIncome: 0, monthlyOtherFamilyIncome: 0, monthlyOtherIncome: 0, incomeFrequency: 'monthly', incomeStability: 'mostly_fixed' },
  expenses: { rentOrHome: 22_000, foodAndGroceries: 9_000, utilities: 2_500, transportation: 3_500, education: 0, healthcare: 1_000, insurancePremiums: 0, lifestyleAndEntertainment: 9_000, subscriptions: 2_000, dependentRelated: 0, otherRecurring: 1_500, annualIrregular: 50_000 },
  assets: [{ id: 'a1', type: 'savings_account', amountInvested: 90_000, currentValue: 90_000, investmentDate: '2025-06-01', monthlyContribution: 0, lockInMonthsRemaining: 0 }],
  emergencyFund: { currentEmergencySavings: 90_000, familyFinancialSupportAvailable: true, expectedMajorEmergencyExpense: 0 },
  goals: [
    { id: 'g1', name: 'Wealth creation', category: 'wealth_creation', requiredAmountToday: 10_000_000, targetDate: '2046-08-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'medium', considerInflation: true },
  ],
  risk: { investmentExperience: 2, productKnowledge: 3, preferredRiskLevel: 5, maxAcceptableDrawdown: 0.40, reactionToMarketDecline: 5, abilityToHandleLosses: 4, investmentTimeHorizon: 25, needForGuaranteedCapital: 5, comfortWithVolatility: 5 },
  preferences: { preferredTypes: ['equity', 'gold', 'crypto'], avoidTypes: [], cryptoOptIn: true, style: 'passive', incomeOrGrowth: 'capital_growth', ethicalPreference: false, interestedInTaxSaving: true },
  liquidity: { amountImmediatelyAccessible: 50_000, expectedWithdrawalsNext12Months: 0, largeExpensesWithin3Years: 0, acceptableLockInMonths: 180, withdrawalFrequency: 'never', minimumBankBalancePreference: 25_000 },
});

/* ------------------------------------------------------------------ */
/* 4. Freelancer with lumpy income                                      */
/* ------------------------------------------------------------------ */

export const freelancer: FinancialProfile = base({
  profileId: 'kabir_34_freelance',
  personal: { fullName: 'Kabir Rao', age: 34, city: 'Goa', state: 'Goa', cityTier: 'tier2', maritalStatus: 'single', familyMembers: 2, dependentMembers: 1, expectedRetirementAge: 60 },
  employment: { occupation: 'Design consultant', employmentType: 'freelancer', industry: 'Creative', yearsOfExperience: 10, employerType: 'none', jobStability: 'volatile', expectedIncomeGrowth: 0.06 },
  income: { monthlyTakeHome: 0, annualGrossIncome: 1_800_000, annualVariableIncome: 600_000, monthlyBusinessIncome: 100_000, monthlyRentalIncome: 0, annualInterestDividendIncome: 24_000, monthlyOtherFamilyIncome: 0, monthlyOtherIncome: 0, incomeFrequency: 'irregular', incomeStability: 'highly_variable' },
  expenses: { rentOrHome: 25_000, foodAndGroceries: 12_000, utilities: 4_000, transportation: 5_000, education: 0, healthcare: 3_000, insurancePremiums: 3_500, lifestyleAndEntertainment: 12_000, subscriptions: 4_000, dependentRelated: 8_000, otherRecurring: 3_000, annualIrregular: 120_000 },
  dependents: [{ id: 'd1', relationship: 'parent', age: 63, monthlyRequirement: 8_000, monthlyEducationExpense: 0, monthlyMedicalExpense: 3_000, expectedFutureRequirement: 500_000, yearsOfDependency: 20 }],
  assets: [
    { id: 'a1', type: 'savings_account', amountInvested: 450_000, currentValue: 450_000, investmentDate: '2025-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a2', type: 'equity_mutual_fund', amountInvested: 600_000, currentValue: 810_000, investmentDate: '2021-04-01', monthlyContribution: 10_000, lockInMonthsRemaining: 0 },
    { id: 'a3', type: 'gold', amountInvested: 200_000, currentValue: 310_000, investmentDate: '2020-08-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
  ],
  insurance: { healthCoverSelf: 500_000, healthCoverFamilyFloater: 0, healthCoverParents: 300_000, termLifeCover: 5_000_000, employerProvidedHealthCover: 0, employerProvidedLifeCover: 0, personalAccidentCover: 1_000_000, criticalIllnessCover: 0, annualPremiumTotal: 42_000, hasInvestmentLinkedPolicy: false },
  emergencyFund: { currentEmergencySavings: 450_000, desiredMonthsOfCover: 12, familyFinancialSupportAvailable: false, expectedMajorEmergencyExpense: 200_000 },
  goals: [
    { id: 'g1', name: 'Buy a house', category: 'house_purchase', requiredAmountToday: 9_000_000, targetDate: '2033-08-01', amountAlreadySaved: 810_000, monthlyAmountCurrentlyInvested: 10_000, priority: 'high', considerInflation: true },
    { id: 'g2', name: 'Retirement', category: 'retirement', requiredAmountToday: 30_000_000, targetDate: '2052-08-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'high', considerInflation: true },
  ],
  risk: { investmentExperience: 4, productKnowledge: 4, preferredRiskLevel: 4, maxAcceptableDrawdown: 0.25, reactionToMarketDecline: 4, abilityToHandleLosses: 3, investmentTimeHorizon: 15, needForGuaranteedCapital: 4, comfortWithVolatility: 4 },
  tax: { taxResidency: 'resident', selectedRegime: 'new', annualEPFContribution: 0, annualPPFContribution: 50_000, annualNPSContributionSelf: 0, annualNPSContributionEmployer: 0, annualLifeInsurancePremium: 18_000, annualHealthInsurancePremium: 24_000, annualELSSInvestment: 0, annualHomeLoanPrincipalRepaid: 0, annualHomeLoanInterestPaid: 0, annualChildTuitionFees: 0, annualCapitalGainsRealised: 0, isSalaried: false },
});

/* ------------------------------------------------------------------ */
/* 5. Dual-income household with a young daughter (household mode)      */
/* ------------------------------------------------------------------ */

export const household: FinancialProfile = base({
  profileId: 'sharma_household',
  planningMode: 'household',
  additionalEarners: [
    { id: 'spouse', name: 'Vikram Sharma', age: 38, annualIncome: 1_800_000, existingTermCover: 5_000_000 },
  ],
  personal: { fullName: 'Neha & Vikram Sharma', age: 36, city: 'Gurugram', state: 'Haryana', cityTier: 'metro', maritalStatus: 'married', familyMembers: 4, dependentMembers: 2, expectedRetirementAge: 58 },
  employment: { occupation: 'Marketing manager', employmentType: 'salaried', industry: 'FMCG', yearsOfExperience: 13, employerType: 'private', jobStability: 'very_stable', expectedIncomeGrowth: 0.09 },
  income: { monthlyTakeHome: 150_000, annualGrossIncome: 2_400_000, annualVariableIncome: 300_000, monthlyBusinessIncome: 0, monthlyRentalIncome: 25_000, annualInterestDividendIncome: 60_000, monthlyOtherFamilyIncome: 110_000, monthlyOtherIncome: 0, incomeFrequency: 'monthly', incomeStability: 'fixed' },
  expenses: { rentOrHome: 15_000, foodAndGroceries: 25_000, utilities: 8_000, transportation: 12_000, education: 30_000, healthcare: 4_000, insurancePremiums: 9_000, lifestyleAndEntertainment: 25_000, subscriptions: 3_000, dependentRelated: 10_000, otherRecurring: 6_000, annualIrregular: 300_000 },
  dependents: [
    { id: 'd1', relationship: 'child', age: 7, gender: 'female', monthlyRequirement: 5_000, monthlyEducationExpense: 20_000, monthlyMedicalExpense: 0, expectedFutureRequirement: 5_000_000, yearsOfDependency: 15 },
    { id: 'd2', relationship: 'child', age: 3, gender: 'male', monthlyRequirement: 5_000, monthlyEducationExpense: 10_000, monthlyMedicalExpense: 0, expectedFutureRequirement: 5_000_000, yearsOfDependency: 19 },
  ],
  assets: [
    { id: 'a1', type: 'savings_account', amountInvested: 800_000, currentValue: 800_000, investmentDate: '2025-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a2', type: 'epf', amountInvested: 1_800_000, currentValue: 2_100_000, investmentDate: '2013-01-01', monthlyContribution: 18_000, lockInMonthsRemaining: 0 },
    { id: 'a3', type: 'equity_mutual_fund', amountInvested: 1_200_000, currentValue: 1_950_000, investmentDate: '2019-05-01', monthlyContribution: 25_000, lockInMonthsRemaining: 0 },
    { id: 'a4', type: 'ppf', amountInvested: 900_000, currentValue: 1_120_000, investmentDate: '2016-04-01', monthlyContribution: 12_500, lockInMonthsRemaining: 60 },
    { id: 'a5', type: 'property_investment', amountInvested: 6_000_000, currentValue: 7_500_000, investmentDate: '2018-11-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
  ],
  liabilities: [{ id: 'l1', type: 'home_loan', outstandingAmount: 4_200_000, interestRate: 0.088, monthlyEMI: 38_000, remainingTenureMonths: 180, prepaymentChargeRate: 0, overdueAmount: 0 }],
  insurance: { healthCoverSelf: 0, healthCoverFamilyFloater: 1_000_000, healthCoverParents: 0, termLifeCover: 15_000_000, employerProvidedHealthCover: 500_000, employerProvidedLifeCover: 2_400_000, personalAccidentCover: 2_000_000, criticalIllnessCover: 1_000_000, annualPremiumTotal: 108_000, hasInvestmentLinkedPolicy: false },
  emergencyFund: { currentEmergencySavings: 800_000, familyFinancialSupportAvailable: true, expectedMajorEmergencyExpense: 0 },
  goals: [
    { id: 'g1', name: "Daughter's higher education (overseas)", category: 'child_education', requiredAmountToday: 8_000_000, targetDate: '2037-06-01', amountAlreadySaved: 1_950_000, monthlyAmountCurrentlyInvested: 25_000, priority: 'critical', considerInflation: true, customInflationRate: 0.09 },
    { id: 'g2', name: "Son's education", category: 'child_education', requiredAmountToday: 6_000_000, targetDate: '2041-06-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'high', considerInflation: true },
    { id: 'g3', name: 'Retirement', category: 'retirement', requiredAmountToday: 60_000_000, targetDate: '2048-04-01', amountAlreadySaved: 3_220_000, monthlyAmountCurrentlyInvested: 30_500, priority: 'high', considerInflation: true },
    { id: 'g4', name: 'Family trip to Japan', category: 'travel', requiredAmountToday: 800_000, targetDate: '2028-04-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'low', considerInflation: true },
  ],
  risk: { investmentExperience: 4, productKnowledge: 4, preferredRiskLevel: 4, maxAcceptableDrawdown: 0.30, reactionToMarketDecline: 4, abilityToHandleLosses: 4, investmentTimeHorizon: 20, needForGuaranteedCapital: 4, comfortWithVolatility: 4 },
  liquidity: { amountImmediatelyAccessible: 500_000, expectedWithdrawalsNext12Months: 200_000, largeExpensesWithin3Years: 800_000, acceptableLockInMonths: 180, withdrawalFrequency: 'occasional', minimumBankBalancePreference: 200_000 },
  tax: { taxResidency: 'resident', selectedRegime: 'undecided', annualEPFContribution: 216_000, annualPPFContribution: 150_000, annualNPSContributionSelf: 0, annualNPSContributionEmployer: 0, annualLifeInsurancePremium: 36_000, annualHealthInsurancePremium: 42_000, annualELSSInvestment: 0, annualHomeLoanPrincipalRepaid: 140_000, annualHomeLoanInterestPaid: 360_000, annualChildTuitionFees: 360_000, annualCapitalGainsRealised: 0, isSalaried: true },
});

/* ------------------------------------------------------------------ */
/* 6. Near-retirement conservative                                      */
/* ------------------------------------------------------------------ */

export const nearRetirement: FinancialProfile = base({
  profileId: 'ramesh_57',
  personal: { fullName: 'Ramesh Iyer', age: 57, city: 'Chennai', state: 'Tamil Nadu', cityTier: 'metro', maritalStatus: 'married', familyMembers: 2, dependentMembers: 1, expectedRetirementAge: 60 },
  employment: { occupation: 'Bank officer', employmentType: 'salaried', industry: 'Banking', yearsOfExperience: 33, employerType: 'psu', jobStability: 'very_stable', expectedIncomeGrowth: 0.05 },
  income: { monthlyTakeHome: 130_000, annualGrossIncome: 1_900_000, annualVariableIncome: 0, monthlyBusinessIncome: 0, monthlyRentalIncome: 18_000, annualInterestDividendIncome: 90_000, monthlyOtherFamilyIncome: 0, monthlyOtherIncome: 0, incomeFrequency: 'monthly', incomeStability: 'fixed' },
  expenses: { rentOrHome: 0, foodAndGroceries: 18_000, utilities: 6_000, transportation: 6_000, education: 0, healthcare: 8_000, insurancePremiums: 6_000, lifestyleAndEntertainment: 10_000, subscriptions: 1_000, dependentRelated: 0, otherRecurring: 5_000, annualIrregular: 150_000 },
  assets: [
    { id: 'a1', type: 'savings_account', amountInvested: 600_000, currentValue: 600_000, investmentDate: '2025-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a2', type: 'fixed_deposit', amountInvested: 2_500_000, currentValue: 2_500_000, investmentDate: '2024-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a3', type: 'epf', amountInvested: 6_000_000, currentValue: 7_400_000, investmentDate: '1993-01-01', monthlyContribution: 15_000, lockInMonthsRemaining: 0 },
    { id: 'a4', type: 'ppf', amountInvested: 2_200_000, currentValue: 3_100_000, investmentDate: '2009-04-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a5', type: 'equity_mutual_fund', amountInvested: 1_500_000, currentValue: 2_600_000, investmentDate: '2016-01-01', monthlyContribution: 15_000, lockInMonthsRemaining: 0 },
  ],
  insurance: { healthCoverSelf: 0, healthCoverFamilyFloater: 1_500_000, healthCoverParents: 0, termLifeCover: 5_000_000, employerProvidedHealthCover: 1_000_000, employerProvidedLifeCover: 1_000_000, personalAccidentCover: 0, criticalIllnessCover: 0, annualPremiumTotal: 72_000, hasInvestmentLinkedPolicy: false },
  emergencyFund: { currentEmergencySavings: 3_100_000, familyFinancialSupportAvailable: true, expectedMajorEmergencyExpense: 0 },
  goals: [
    { id: 'g1', name: 'Retirement income', category: 'retirement', requiredAmountToday: 40_000_000, targetDate: '2029-04-01', amountAlreadySaved: 13_100_000, monthlyAmountCurrentlyInvested: 30_000, priority: 'critical', considerInflation: true },
  ],
  risk: { investmentExperience: 4, productKnowledge: 3, preferredRiskLevel: 2, maxAcceptableDrawdown: 0.10, reactionToMarketDecline: 2, abilityToHandleLosses: 2, investmentTimeHorizon: 5, needForGuaranteedCapital: 2, comfortWithVolatility: 2 },
  liquidity: { amountImmediatelyAccessible: 1_000_000, expectedWithdrawalsNext12Months: 0, largeExpensesWithin3Years: 500_000, acceptableLockInMonths: 36, withdrawalFrequency: 'occasional', minimumBankBalancePreference: 300_000 },
  preferences: { preferredTypes: ['debt', 'equity', 'gold'], avoidTypes: ['crypto'], cryptoOptIn: false, style: 'passive', incomeOrGrowth: 'regular_income', ethicalPreference: false, interestedInTaxSaving: true },
  tax: { taxResidency: 'resident', selectedRegime: 'old', annualEPFContribution: 180_000, annualPPFContribution: 0, annualNPSContributionSelf: 0, annualNPSContributionEmployer: 0, annualLifeInsurancePremium: 24_000, annualHealthInsurancePremium: 48_000, annualELSSInvestment: 0, annualHomeLoanPrincipalRepaid: 0, annualHomeLoanInterestPaid: 0, annualChildTuitionFees: 0, annualCapitalGainsRealised: 40_000, isSalaried: true },
});

/* ------------------------------------------------------------------ */
/* 7. High earner, aggressive appetite, zero emergency fund             */
/*    — the capacity/tolerance divergence case                          */
/* ------------------------------------------------------------------ */

export const overconfident: FinancialProfile = base({
  profileId: 'arjun_31_divergent',
  personal: { fullName: 'Arjun Mehta', age: 31, city: 'Mumbai', state: 'Maharashtra', cityTier: 'metro', maritalStatus: 'married', familyMembers: 3, dependentMembers: 2, expectedRetirementAge: 55 },
  employment: { occupation: 'Product manager', employmentType: 'salaried', industry: 'Fintech', yearsOfExperience: 8, employerType: 'startup', jobStability: 'uncertain', expectedIncomeGrowth: 0.12 },
  income: { monthlyTakeHome: 220_000, annualGrossIncome: 3_600_000, annualVariableIncome: 900_000, monthlyBusinessIncome: 0, monthlyRentalIncome: 0, annualInterestDividendIncome: 0, monthlyOtherFamilyIncome: 0, monthlyOtherIncome: 0, incomeFrequency: 'monthly', incomeStability: 'variable' },
  expenses: { rentOrHome: 85_000, foodAndGroceries: 25_000, utilities: 8_000, transportation: 15_000, education: 0, healthcare: 3_000, insurancePremiums: 2_000, lifestyleAndEntertainment: 40_000, subscriptions: 5_000, dependentRelated: 5_000, otherRecurring: 8_000, annualIrregular: 400_000 },
  dependents: [{ id: 'd1', relationship: 'child', age: 2, gender: 'male', monthlyRequirement: 5_000, monthlyEducationExpense: 0, monthlyMedicalExpense: 0, expectedFutureRequirement: 8_000_000, yearsOfDependency: 20 }],
  assets: [
    { id: 'a1', type: 'savings_account', amountInvested: 180_000, currentValue: 180_000, investmentDate: '2026-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a2', type: 'stocks', amountInvested: 900_000, currentValue: 740_000, investmentDate: '2024-02-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a3', type: 'crypto', amountInvested: 500_000, currentValue: 320_000, investmentDate: '2024-11-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
  ],
  liabilities: [
    { id: 'l1', type: 'car_loan', outstandingAmount: 1_100_000, interestRate: 0.105, monthlyEMI: 24_000, remainingTenureMonths: 54, prepaymentChargeRate: 0.02, overdueAmount: 0 },
    { id: 'l2', type: 'personal_loan', outstandingAmount: 400_000, interestRate: 0.155, monthlyEMI: 13_500, remainingTenureMonths: 36, prepaymentChargeRate: 0.03, overdueAmount: 0 },
  ],
  insurance: { healthCoverSelf: 0, healthCoverFamilyFloater: 0, healthCoverParents: 0, termLifeCover: 0, employerProvidedHealthCover: 500_000, employerProvidedLifeCover: 3_600_000, personalAccidentCover: 0, criticalIllnessCover: 0, annualPremiumTotal: 24_000, hasInvestmentLinkedPolicy: false },
  emergencyFund: { currentEmergencySavings: 180_000, familyFinancialSupportAvailable: false, expectedMajorEmergencyExpense: 0 },
  goals: [
    { id: 'g1', name: 'Financial independence', category: 'retirement', requiredAmountToday: 80_000_000, targetDate: '2050-08-01', amountAlreadySaved: 1_060_000, monthlyAmountCurrentlyInvested: 0, priority: 'high', considerInflation: true },
    { id: 'g2', name: 'Second home', category: 'house_purchase', requiredAmountToday: 25_000_000, targetDate: '2034-08-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'medium', considerInflation: true },
  ],
  risk: { investmentExperience: 4, productKnowledge: 4, preferredRiskLevel: 5, maxAcceptableDrawdown: 0.45, reactionToMarketDecline: 5, abilityToHandleLosses: 5, investmentTimeHorizon: 20, needForGuaranteedCapital: 5, comfortWithVolatility: 5 },
  preferences: { preferredTypes: ['equity', 'crypto'], avoidTypes: [], cryptoOptIn: true, style: 'active', incomeOrGrowth: 'capital_growth', ethicalPreference: false, interestedInTaxSaving: false },
  tax: { taxResidency: 'resident', selectedRegime: 'new', annualEPFContribution: 259_200, annualPPFContribution: 0, annualNPSContributionSelf: 0, annualNPSContributionEmployer: 180_000, annualLifeInsurancePremium: 0, annualHealthInsurancePremium: 0, annualELSSInvestment: 0, annualHomeLoanPrincipalRepaid: 0, annualHomeLoanInterestPaid: 0, annualChildTuitionFees: 0, annualCapitalGainsRealised: 0, isSalaried: true },
});

/* ------------------------------------------------------------------ */
/* 8. Conservative saver who avoids equity entirely                     */
/* ------------------------------------------------------------------ */

export const equityAverse: FinancialProfile = base({
  profileId: 'sunita_45_noequity',
  personal: { fullName: 'Sunita Bansal', age: 45, city: 'Jaipur', state: 'Rajasthan', cityTier: 'tier2', maritalStatus: 'widowed', familyMembers: 2, dependentMembers: 1, expectedRetirementAge: 60 },
  employment: { occupation: 'Teacher', employmentType: 'salaried', industry: 'Education', yearsOfExperience: 20, employerType: 'government', jobStability: 'very_stable', expectedIncomeGrowth: 0.06 },
  income: { monthlyTakeHome: 72_000, annualGrossIncome: 1_050_000, annualVariableIncome: 0, monthlyBusinessIncome: 0, monthlyRentalIncome: 0, annualInterestDividendIncome: 45_000, monthlyOtherFamilyIncome: 0, monthlyOtherIncome: 0, incomeFrequency: 'monthly', incomeStability: 'fixed' },
  expenses: { rentOrHome: 0, foodAndGroceries: 12_000, utilities: 4_000, transportation: 3_000, education: 12_000, healthcare: 3_000, insurancePremiums: 4_000, lifestyleAndEntertainment: 4_000, subscriptions: 500, dependentRelated: 3_000, otherRecurring: 2_500, annualIrregular: 60_000 },
  dependents: [{ id: 'd1', relationship: 'child', age: 15, gender: 'female', monthlyRequirement: 3_000, monthlyEducationExpense: 12_000, monthlyMedicalExpense: 0, expectedFutureRequirement: 3_000_000, yearsOfDependency: 8 }],
  assets: [
    { id: 'a1', type: 'savings_account', amountInvested: 350_000, currentValue: 350_000, investmentDate: '2025-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a2', type: 'fixed_deposit', amountInvested: 1_400_000, currentValue: 1_400_000, investmentDate: '2024-04-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a3', type: 'ppf', amountInvested: 800_000, currentValue: 1_050_000, investmentDate: '2014-04-01', monthlyContribution: 5_000, lockInMonthsRemaining: 24 },
    { id: 'a4', type: 'property_self_occupied', amountInvested: 2_500_000, currentValue: 3_800_000, investmentDate: '2012-06-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
  ],
  insurance: { healthCoverSelf: 0, healthCoverFamilyFloater: 500_000, healthCoverParents: 0, termLifeCover: 2_500_000, employerProvidedHealthCover: 200_000, employerProvidedLifeCover: 0, personalAccidentCover: 0, criticalIllnessCover: 0, annualPremiumTotal: 48_000, hasInvestmentLinkedPolicy: true },
  emergencyFund: { currentEmergencySavings: 1_750_000, familyFinancialSupportAvailable: false, expectedMajorEmergencyExpense: 0 },
  goals: [
    { id: 'g1', name: "Daughter's college", category: 'child_education', requiredAmountToday: 3_000_000, targetDate: '2029-06-01', amountAlreadySaved: 1_050_000, monthlyAmountCurrentlyInvested: 5_000, priority: 'critical', considerInflation: true },
    { id: 'g2', name: 'Retirement', category: 'retirement', requiredAmountToday: 20_000_000, targetDate: '2041-04-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'high', considerInflation: true },
  ],
  risk: { investmentExperience: 1, productKnowledge: 2, preferredRiskLevel: 1, maxAcceptableDrawdown: 0.05, reactionToMarketDecline: 1, abilityToHandleLosses: 2, investmentTimeHorizon: 8, needForGuaranteedCapital: 1, comfortWithVolatility: 1 },
  preferences: { preferredTypes: ['debt', 'gold'], avoidTypes: ['equity', 'crypto'], cryptoOptIn: false, style: 'passive', incomeOrGrowth: 'regular_income', ethicalPreference: false, interestedInTaxSaving: true },
  liquidity: { amountImmediatelyAccessible: 300_000, expectedWithdrawalsNext12Months: 0, largeExpensesWithin3Years: 0, acceptableLockInMonths: 36, withdrawalFrequency: 'rare', minimumBankBalancePreference: 100_000 },
  tax: { taxResidency: 'resident', selectedRegime: 'old', annualEPFContribution: 96_000, annualPPFContribution: 60_000, annualNPSContributionSelf: 0, annualNPSContributionEmployer: 0, annualLifeInsurancePremium: 48_000, annualHealthInsurancePremium: 18_000, annualELSSInvestment: 0, annualHomeLoanPrincipalRepaid: 0, annualHomeLoanInterestPaid: 0, annualChildTuitionFees: 144_000, annualCapitalGainsRealised: 0, isSalaried: true },
});

/* ------------------------------------------------------------------ */
/* 9. Legacy portfolio badly overweight equity near retirement         */
/*    — the case the rebalancing module exists for                     */
/* ------------------------------------------------------------------ */

export const overweightEquity: FinancialProfile = base({
  profileId: 'prakash_58_overweight',
  personal: { fullName: 'Prakash Nair', age: 58, city: 'Kochi', state: 'Kerala', cityTier: 'tier2', maritalStatus: 'married', familyMembers: 2, dependentMembers: 1, expectedRetirementAge: 62 },
  employment: { occupation: 'Sales director', employmentType: 'salaried', industry: 'Pharma', yearsOfExperience: 32, employerType: 'private', jobStability: 'stable', expectedIncomeGrowth: 0.05 },
  income: { monthlyTakeHome: 180_000, annualGrossIncome: 2_800_000, annualVariableIncome: 200_000, monthlyBusinessIncome: 0, monthlyRentalIncome: 0, annualInterestDividendIncome: 80_000, monthlyOtherFamilyIncome: 0, monthlyOtherIncome: 0, incomeFrequency: 'monthly', incomeStability: 'fixed' },
  expenses: { rentOrHome: 0, foodAndGroceries: 20_000, utilities: 7_000, transportation: 8_000, education: 0, healthcare: 6_000, insurancePremiums: 9_000, lifestyleAndEntertainment: 15_000, subscriptions: 2_000, dependentRelated: 5_000, otherRecurring: 6_000, annualIrregular: 200_000 },
  dependents: [{ id: 'd1', relationship: 'spouse', age: 55, monthlyRequirement: 5_000, monthlyEducationExpense: 0, monthlyMedicalExpense: 3_000, expectedFutureRequirement: 0, yearsOfDependency: 30 }],
  assets: [
    { id: 'a1', type: 'savings_account', amountInvested: 500_000, currentValue: 500_000, investmentDate: '2025-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a2', type: 'equity_mutual_fund', label: 'Equity mutual funds (held 12 years)', amountInvested: 3_500_000, currentValue: 11_200_000, investmentDate: '2014-03-01', monthlyContribution: 20_000, lockInMonthsRemaining: 0 },
    { id: 'a3', type: 'stocks', label: 'Direct equity portfolio', amountInvested: 1_800_000, currentValue: 4_100_000, investmentDate: '2017-06-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a4', type: 'epf', amountInvested: 2_600_000, currentValue: 3_400_000, investmentDate: '1994-01-01', monthlyContribution: 21_000, lockInMonthsRemaining: 0 },
    { id: 'a5', type: 'gold', amountInvested: 300_000, currentValue: 520_000, investmentDate: '2019-02-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
    { id: 'a6', type: 'property_self_occupied', amountInvested: 3_500_000, currentValue: 8_000_000, investmentDate: '2008-05-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
  ],
  insurance: { healthCoverSelf: 0, healthCoverFamilyFloater: 1_500_000, healthCoverParents: 0, termLifeCover: 5_000_000, employerProvidedHealthCover: 500_000, employerProvidedLifeCover: 2_800_000, personalAccidentCover: 0, criticalIllnessCover: 500_000, annualPremiumTotal: 108_000, hasInvestmentLinkedPolicy: false },
  emergencyFund: { currentEmergencySavings: 500_000, familyFinancialSupportAvailable: true, expectedMajorEmergencyExpense: 0 },
  goals: [
    { id: 'g1', name: 'Retirement', category: 'retirement', requiredAmountToday: 40_000_000, targetDate: '2030-08-01', amountAlreadySaved: 19_220_000, monthlyAmountCurrentlyInvested: 41_000, priority: 'critical', considerInflation: true },
  ],
  risk: { investmentExperience: 5, productKnowledge: 4, preferredRiskLevel: 3, maxAcceptableDrawdown: 0.15, reactionToMarketDecline: 3, abilityToHandleLosses: 3, investmentTimeHorizon: 12, needForGuaranteedCapital: 3, comfortWithVolatility: 3 },
  liquidity: { amountImmediatelyAccessible: 500_000, expectedWithdrawalsNext12Months: 0, largeExpensesWithin3Years: 0, acceptableLockInMonths: 36, withdrawalFrequency: 'rare', minimumBankBalancePreference: 200_000 },
  preferences: { preferredTypes: ['equity', 'debt', 'gold'], avoidTypes: ['crypto'], cryptoOptIn: false, style: 'active', incomeOrGrowth: 'balanced', ethicalPreference: false, interestedInTaxSaving: true },
  tax: { taxResidency: 'resident', selectedRegime: 'undecided', annualEPFContribution: 252_000, annualPPFContribution: 0, annualNPSContributionSelf: 0, annualNPSContributionEmployer: 0, annualLifeInsurancePremium: 30_000, annualHealthInsurancePremium: 48_000, annualELSSInvestment: 0, annualHomeLoanPrincipalRepaid: 0, annualHomeLoanInterestPaid: 0, annualChildTuitionFees: 0, annualCapitalGainsRealised: 0, isSalaried: true },
});

export const ALL_PERSONAS: { key: string; label: string; profile: FinancialProfile }[] = [
  { key: 'rohan', label: 'Rohan, 29 — salaried, credit-card debt, no term cover', profile: rohan },
  { key: 'deficit', label: 'Meena, 38 — business owner running a monthly deficit', profile: deficitHousehold },
  { key: 'first_job', label: 'Aditi, 23 — first job, long horizon, crypto opt-in', profile: firstJob },
  { key: 'freelancer', label: 'Kabir, 34 — freelancer, lumpy income, wants a house', profile: freelancer },
  { key: 'household', label: 'Sharma household, 36 — dual income, two children', profile: household },
  { key: 'near_retirement', label: 'Ramesh, 57 — three years from retirement', profile: nearRetirement },
  { key: 'divergent', label: 'Arjun, 31 — high earner, aggressive appetite, no buffer', profile: overconfident },
  { key: 'equity_averse', label: 'Sunita, 45 — sole earner, refuses equity', profile: equityAverse },
  { key: 'overweight_equity', label: 'Prakash, 58 — ₹1.9 Cr portfolio, badly overweight equity', profile: overweightEquity },
];
