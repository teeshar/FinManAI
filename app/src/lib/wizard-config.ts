/**
 * The eight-step onboarding wizard, described as data.
 *
 * Eight hand-written forms would be several thousand lines that drift out of
 * sync with the Zod schema within a month. Describing the fields instead means
 * one renderer, one place to change a label, and a structure that can be
 * diffed against `validation.ts` when either moves.
 *
 * `help` is not decoration. People abandon financial onboarding when a question
 * feels intrusive and unexplained — "why do you need my daughter's age" has a
 * real answer, and showing it is the difference between a completed profile and
 * a bounce.
 */

export type FieldKind =
  | 'text' | 'number' | 'money' | 'percent' | 'select' | 'radio'
  | 'checkbox' | 'date' | 'scale5';

export type FieldDef = {
  /** Dot path into the step's data object, e.g. "personal.age". */
  path: string;
  label: string;
  kind: FieldKind;
  help?: string;
  options?: { value: string; label: string }[];
  /** Labels for the two ends of a 1–5 scale. */
  scaleLabels?: [string, string];
  placeholder?: string;
  optional?: boolean;
  /** Show only when another field has one of these values. */
  showWhen?: { path: string; equals: (string | number | boolean)[] };
  suffix?: string;
};

export type RepeaterDef = {
  path: string;
  label: string;
  addLabel: string;
  help?: string;
  /** Template for a new row. `id` is filled in by the client. */
  template: Record<string, unknown>;
  fields: FieldDef[];
};

export type StepDef = {
  step: number;
  title: string;
  /**
   * One or two words for the progress rail, where eight full titles will not
   * fit on any screen anyone owns. Kept here rather than derived in the
   * component so the two names for a step cannot drift apart.
   */
  short: string;
  intro: string;
  fields?: FieldDef[];
  repeaters?: RepeaterDef[];
  /** Shown above the Continue button. */
  reassurance?: string;
};

const yesNo = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

export const WIZARD: StepDef[] = [
  /* ---------------------------------------------------------------- */
  {
    step: 1,
    title: 'About you',
    short: 'You',
    intro:
      'We start with the basics. Your age and retirement age set the time horizon for everything that follows — they matter more to the outcome than almost anything else you will enter.',
    fields: [
      {
        path: 'planningMode', label: 'Who is this plan for?', kind: 'radio',
        options: [
          { value: 'individual', label: 'Just me' },
          { value: 'household', label: 'My household — plan our finances jointly' },
        ],
        help: 'Household planning combines incomes and goals. It gives better advice for couples, and it means life cover is sized for each earner separately rather than on a pooled figure.',
      },
      { path: 'personal.fullName', label: 'Full name', kind: 'text' },
      { path: 'personal.age', label: 'Age', kind: 'number', suffix: 'years' },
      {
        path: 'personal.expectedRetirementAge', label: 'When do you expect to retire?',
        kind: 'number', suffix: 'years',
        help: 'A best guess is fine. You can change it later and regenerate the plan.',
      },
      {
        path: 'personal.gender', label: 'Gender', kind: 'select', optional: true,
        options: [
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
          { value: 'other', label: 'Prefer not to say' },
        ],
        help: 'Asked only because term insurance is priced differently — women pay roughly 25% less for the same cover. Leave it blank and we quote the dearer figure, so the plan is never short.',
      },
      {
        path: 'personal.smoker', label: 'Do you smoke or use tobacco?', kind: 'radio',
        optional: true, options: yesNo,
        help: 'Smokers pay 40–60% more for term cover. Answer honestly — insurers test at underwriting, and a policy bought on a false declaration can be refused at exactly the moment your family needs it.',
      },
      { path: 'personal.city', label: 'City', kind: 'text' },
      { path: 'personal.state', label: 'State', kind: 'text' },
      {
        path: 'personal.cityTier', label: 'What kind of city is it?', kind: 'select',
        options: [
          { value: 'metro', label: 'Metro (Mumbai, Delhi, Bengaluru, Chennai, Kolkata, Hyderabad, Pune)' },
          { value: 'tier2', label: 'Tier 2 city' },
          { value: 'tier3', label: 'Tier 3 city or smaller' },
        ],
        help: 'This sets the health-cover benchmark. Treatment in a metro hospital costs materially more.',
      },
      {
        path: 'personal.maritalStatus', label: 'Marital status', kind: 'select',
        options: [
          { value: 'single', label: 'Single' },
          { value: 'married', label: 'Married' },
          { value: 'divorced', label: 'Divorced' },
          { value: 'widowed', label: 'Widowed' },
        ],
      },
      { path: 'personal.familyMembers', label: 'People in your household', kind: 'number' },
      {
        path: 'personal.dependentMembers', label: 'How many depend on your income?',
        kind: 'number',
        help: 'This drives your life-cover requirement. If nobody depends on your income, you may not need term insurance at all — and we will say so.',
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  {
    step: 2,
    title: 'Work and income',
    short: 'Income',
    intro:
      'How much comes in, and how reliably. Stability matters as much as amount: a steady ₹80,000 supports more risk than a volatile ₹1,50,000.',
    fields: [
      { path: 'employment.occupation', label: 'What do you do?', kind: 'text' },
      {
        path: 'employment.employmentType', label: 'Employment type', kind: 'select',
        options: [
          { value: 'salaried', label: 'Salaried' },
          { value: 'self_employed', label: 'Self-employed' },
          { value: 'business_owner', label: 'Business owner' },
          { value: 'freelancer', label: 'Freelancer / consultant' },
          { value: 'retired', label: 'Retired' },
        ],
      },
      {
        path: 'employment.employerType', label: 'Employer type', kind: 'select',
        options: [
          { value: 'private', label: 'Private company' },
          { value: 'government', label: 'Government' },
          { value: 'psu', label: 'PSU' },
          { value: 'startup', label: 'Startup' },
          { value: 'business', label: 'My own business' },
          { value: 'none', label: 'Not applicable' },
        ],
      },
      { path: 'employment.industry', label: 'Industry', kind: 'text', optional: true },
      { path: 'employment.yearsOfExperience', label: 'Years of experience', kind: 'number', optional: true },
      {
        path: 'employment.jobStability', label: 'How secure does your income feel?', kind: 'radio',
        options: [
          { value: 'very_stable', label: 'Very secure' },
          { value: 'stable', label: 'Reasonably secure' },
          { value: 'uncertain', label: 'Somewhat uncertain' },
          { value: 'volatile', label: 'Volatile' },
        ],
        help: 'Answer honestly rather than optimistically. This sets how deep an emergency fund we recommend.',
      },
      {
        path: 'employment.expectedIncomeGrowth', label: 'Expected annual income growth',
        kind: 'percent', suffix: '% a year',
        help: 'Used to plan a contribution that rises over time rather than a flat amount held for decades. We cap the assumption at 10% however optimistic the answer.',
      },
      { path: 'income.monthlyTakeHome', label: 'Monthly take-home pay', kind: 'money', help: 'After tax and deductions — what actually reaches your account.' },
      { path: 'income.annualGrossIncome', label: 'Annual gross income (CTC)', kind: 'money' },
      {
        path: 'income.annualVariableIncome', label: 'Annual bonus or commission', kind: 'money', optional: true,
        help: 'We only plan on half of this. A bonus is a hope, not a salary, and a plan that depends on one breaks in a bad year.',
      },
      { path: 'income.monthlyBusinessIncome', label: 'Monthly business or freelance income', kind: 'money', optional: true },
      { path: 'income.monthlyRentalIncome', label: 'Monthly rental income', kind: 'money', optional: true },
      { path: 'income.annualInterestDividendIncome', label: 'Annual interest and dividends', kind: 'money', optional: true },
      {
        path: 'income.monthlyOtherFamilyIncome', label: 'Other household income, per month',
        kind: 'money', optional: true,
        showWhen: { path: 'planningMode', equals: ['household'] },
      },
      {
        path: 'income.incomeStability', label: 'How predictable is your income?', kind: 'radio',
        options: [
          { value: 'fixed', label: 'Fixed — same every month' },
          { value: 'mostly_fixed', label: 'Mostly fixed, small variation' },
          { value: 'variable', label: 'Variable' },
          { value: 'highly_variable', label: 'Highly variable' },
        ],
      },
    ],
    repeaters: [
      {
        path: 'additionalEarners',
        label: 'Other earners in the household',
        addLabel: 'Add an earner',
        help: 'Life cover is calculated for each earner separately. If one of you dies the survivor keeps their own income but loses the other\'s entirely — a single policy against the combined figure leaves a gap.',
        template: { name: '', age: 35, annualIncome: 0, existingTermCover: 0, smoker: false },
        fields: [
          { path: 'name', label: 'Name', kind: 'text' },
          { path: 'age', label: 'Age', kind: 'number' },
          {
            path: 'gender', label: 'Gender', kind: 'select', optional: true,
            options: [
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'other', label: 'Prefer not to say' },
            ],
          },
          { path: 'smoker', label: 'Smokes or uses tobacco?', kind: 'radio', optional: true, options: yesNo },
          { path: 'annualIncome', label: 'Annual income', kind: 'money' },
          { path: 'existingTermCover', label: 'Term cover they already hold', kind: 'money', optional: true },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  {
    step: 3,
    title: 'Spending',
    short: 'Spending',
    intro:
      'Rather than ask you to remember twelve numbers, we have sketched what a household like yours usually spends. Correct anything that is wrong. Most people underestimate this by 20–30%, so if a figure looks high, check a bank statement before you lower it — an overstated surplus produces a plan you cannot actually follow.',
    fields: [
      { path: 'expenses.rentOrHome', label: 'Rent or home upkeep', kind: 'money', help: 'Exclude the home-loan EMI — that comes later, under loans.' },
      { path: 'expenses.foodAndGroceries', label: 'Food and groceries', kind: 'money' },
      { path: 'expenses.utilities', label: 'Utilities', kind: 'money', optional: true },
      { path: 'expenses.transportation', label: 'Transport and fuel', kind: 'money', optional: true },
      { path: 'expenses.education', label: 'Education fees', kind: 'money', optional: true },
      { path: 'expenses.healthcare', label: 'Healthcare, out of pocket', kind: 'money', optional: true },
      { path: 'expenses.insurancePremiums', label: 'Insurance premiums', kind: 'money', optional: true },
      { path: 'expenses.lifestyleAndEntertainment', label: 'Lifestyle and eating out', kind: 'money', optional: true },
      { path: 'expenses.subscriptions', label: 'Subscriptions', kind: 'money', optional: true },
      { path: 'expenses.dependentRelated', label: 'Support sent to family', kind: 'money', optional: true },
      { path: 'expenses.otherRecurring', label: 'Anything else, monthly', kind: 'money', optional: true },
      {
        path: 'expenses.annualIrregular', label: 'Irregular yearly spending', kind: 'money', optional: true,
        help: 'Festivals, travel, insurance renewals, repairs. Lumpy costs are what quietly break a monthly budget, so we spread them across the year.',
      },
    ],
    reassurance: 'Round numbers are fine. Close and honest beats precise and optimistic.',
  },

  /* ---------------------------------------------------------------- */
  {
    step: 4,
    title: 'Family',
    short: 'Family',
    intro:
      'Who depends on you, and for how long. This drives your life-cover requirement and several goals — and it is the section people most often leave incomplete, which is why so many households are underinsured.',
    repeaters: [
      {
        path: 'dependents',
        label: 'Dependants',
        addLabel: 'Add a dependant',
        template: { relationship: 'child', age: 0, monthlyRequirement: 0, monthlyEducationExpense: 0, monthlyMedicalExpense: 0, expectedFutureRequirement: 0, yearsOfDependency: 18 },
        fields: [
          {
            path: 'relationship', label: 'Relationship', kind: 'select',
            options: [
              { value: 'child', label: 'Child' },
              { value: 'spouse', label: 'Spouse' },
              { value: 'parent', label: 'Parent' },
              { value: 'sibling', label: 'Sibling' },
              { value: 'other', label: 'Other' },
            ],
          },
          { path: 'age', label: 'Age', kind: 'number' },
          {
            path: 'gender', label: 'Gender', kind: 'select', optional: true,
            options: [
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'other', label: 'Prefer not to say' },
            ],
            help: 'Asked only because Sukanya Samriddhi Yojana — currently 8.2%, tax-free, the best fixed-income rate available to anyone — requires a girl child under 10. We check eligibility so you do not miss it.',
          },
          { path: 'monthlyRequirement', label: 'Monthly support', kind: 'money', optional: true },
          { path: 'monthlyEducationExpense', label: 'Monthly education cost', kind: 'money', optional: true },
          { path: 'monthlyMedicalExpense', label: 'Monthly medical cost', kind: 'money', optional: true },
          { path: 'expectedFutureRequirement', label: 'Known future lump sum', kind: 'money', optional: true, help: "In today's money — for example college fees or a wedding." },
          { path: 'yearsOfDependency', label: 'Years they will depend on you', kind: 'number', optional: true },
        ],
      },
    ],
    reassurance: 'No dependants? Continue — we will tell you that term insurance is optional for you, which saves most single people a real amount of money.',
  },

  /* ---------------------------------------------------------------- */
  {
    step: 5,
    title: 'What you own and owe',
    short: 'Assets & debts',
    intro:
      'Your existing portfolio is usually far larger than anything you will invest this month, so getting it right matters more than the monthly figure. We will also tell you where it drifts from target, and what selling would cost in tax.',
    repeaters: [
      {
        path: 'assets',
        label: 'What you own',
        addLabel: 'Add an asset',
        template: { type: 'savings_account', currentValue: 0, amountInvested: 0, investmentDate: '2024-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0 },
        fields: [
          {
            path: 'type', label: 'Type', kind: 'select',
            options: [
              { value: 'savings_account', label: 'Savings account' },
              { value: 'fixed_deposit', label: 'Fixed deposit' },
              { value: 'recurring_deposit', label: 'Recurring deposit' },
              { value: 'epf', label: 'EPF' },
              { value: 'ppf', label: 'PPF' },
              { value: 'nps', label: 'NPS' },
              { value: 'sukanya_samriddhi', label: 'Sukanya Samriddhi' },
              { value: 'equity_mutual_fund', label: 'Equity mutual fund' },
              { value: 'debt_mutual_fund', label: 'Debt mutual fund' },
              { value: 'hybrid_mutual_fund', label: 'Hybrid mutual fund' },
              { value: 'stocks', label: 'Direct stocks' },
              { value: 'bonds', label: 'Bonds' },
              { value: 'gold', label: 'Gold' },
              { value: 'reit_invit', label: 'REIT / InvIT' },
              { value: 'property_self_occupied', label: 'Home you live in' },
              { value: 'property_investment', label: 'Investment property' },
              { value: 'business_ownership', label: 'Business ownership' },
              { value: 'crypto', label: 'Crypto' },
              { value: 'ulip', label: 'ULIP' },
              { value: 'endowment_policy', label: 'Endowment / money-back policy' },
              { value: 'other', label: 'Other' },
            ],
          },
          { path: 'label', label: 'Description', kind: 'text', optional: true, placeholder: 'e.g. HDFC savings' },
          { path: 'currentValue', label: 'Value today', kind: 'money' },
          { path: 'amountInvested', label: 'Amount originally invested', kind: 'money', optional: true, help: 'Needed to work out the tax if you ever sell.' },
          { path: 'investmentDate', label: 'When did you start it?', kind: 'date', help: 'Holding period decides the tax rate — 12 months for equity, 24 for gold and property.' },
          { path: 'monthlyContribution', label: 'Monthly contribution', kind: 'money', optional: true },
          { path: 'lockInMonthsRemaining', label: 'Months still locked in', kind: 'number', optional: true },
          { path: 'surrenderValue', label: 'Surrender value', kind: 'money', optional: true, help: 'ULIP or endowment only. Ask your insurer in writing — it is the one number that decides whether surrendering beats continuing.' },
          { path: 'sumAssured', label: 'Life cover the policy provides', kind: 'money', optional: true },
          { path: 'remainingPremiumYears', label: 'Years of premium left', kind: 'number', optional: true },
        ],
      },
      {
        path: 'liabilities',
        label: 'What you owe',
        addLabel: 'Add a loan or debt',
        help: 'Include credit-card balances you carry month to month. At 36–42% they are almost always the first thing to clear.',
        template: { type: 'home_loan', outstandingAmount: 0, interestRate: 0.09, monthlyEMI: 0, remainingTenureMonths: 0, prepaymentChargeRate: 0, overdueAmount: 0 },
        fields: [
          {
            path: 'type', label: 'Type', kind: 'select',
            options: [
              { value: 'home_loan', label: 'Home loan' },
              { value: 'car_loan', label: 'Car loan' },
              { value: 'personal_loan', label: 'Personal loan' },
              { value: 'education_loan', label: 'Education loan' },
              { value: 'gold_loan', label: 'Gold loan' },
              { value: 'business_loan', label: 'Business loan' },
              { value: 'credit_card', label: 'Credit card outstanding' },
              { value: 'bnpl', label: 'Buy now pay later' },
              { value: 'family_borrowing', label: 'Borrowed from family' },
              { value: 'other', label: 'Other' },
            ],
          },
          { path: 'outstandingAmount', label: 'Amount outstanding', kind: 'money' },
          { path: 'interestRate', label: 'Interest rate', kind: 'percent', suffix: '% a year' },
          { path: 'monthlyEMI', label: 'Monthly EMI', kind: 'money', optional: true },
          { path: 'remainingTenureMonths', label: 'Months remaining', kind: 'number', optional: true },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  {
    step: 6,
    title: 'Protection',
    short: 'Protection',
    intro:
      'Insurance comes before investing, and the ordering is deliberate. An uninsured earner\'s portfolio is one hospitalisation away from being liquidated at the worst possible moment.',
    fields: [
      { path: 'insurance.termLifeCover', label: 'Term life cover you hold', kind: 'money', optional: true, help: 'Pure term insurance only — not ULIPs or endowment policies.' },
      {
        path: 'insurance.employerProvidedLifeCover', label: 'Life cover from your employer',
        kind: 'money', optional: true,
        help: 'Counted at half weight: it ends the day the job does.',
      },
      { path: 'insurance.healthCoverSelf', label: 'Personal health cover', kind: 'money', optional: true },
      { path: 'insurance.healthCoverFamilyFloater', label: 'Family floater cover', kind: 'money', optional: true },
      { path: 'insurance.healthCoverParents', label: 'Cover for parents', kind: 'money', optional: true },
      {
        path: 'insurance.employerProvidedHealthCover', label: 'Health cover from your employer',
        kind: 'money', optional: true,
        help: 'Also counted at half weight. It disappears exactly when you are most likely to need it — if illness costs you the job.',
      },
      { path: 'insurance.personalAccidentCover', label: 'Personal accident cover', kind: 'money', optional: true },
      { path: 'insurance.criticalIllnessCover', label: 'Critical illness cover', kind: 'money', optional: true },
      { path: 'insurance.annualPremiumTotal', label: 'Total annual premiums', kind: 'money', optional: true },
      {
        path: 'insurance.hasInvestmentLinkedPolicy', label: 'Do you hold a ULIP or endowment policy?',
        kind: 'radio', options: yesNo,
        help: 'We will calculate whether surrendering and buying term insurance separately leaves you better off. For most households it does, often by lakhs.',
      },
      { path: 'emergencyFund.currentEmergencySavings', label: 'Money you could reach within a day or two', kind: 'money' },
      {
        path: 'emergencyFund.desiredMonthsOfCover', label: 'Months of cover you would like', kind: 'number',
        optional: true, suffix: 'months',
        help: 'Leave blank and we will set it from your income stability — typically 6 months, more if your income is variable.',
      },
      {
        path: 'emergencyFund.familyFinancialSupportAvailable',
        label: 'Could family help in a genuine emergency?', kind: 'radio', options: yesNo, optional: true,
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  {
    step: 7,
    title: 'Goals and risk',
    short: 'Goals',
    intro:
      'What the money is for, and how much movement you can live with. Goals are what turn saving into planning — without at least one, we are only measuring.',
    repeaters: [
      {
        path: 'goals',
        label: 'Your goals',
        addLabel: 'Add a goal',
        help: "Enter what it would cost in today's money. We add inflation ourselves — 10% a year for education, 6% for most things.",
        template: { name: '', category: 'wealth_creation', requiredAmountToday: 0, targetDate: '2035-01-01', amountAlreadySaved: 0, monthlyAmountCurrentlyInvested: 0, priority: 'medium', considerInflation: true },
        fields: [
          { path: 'name', label: 'What is it?', kind: 'text', placeholder: "e.g. Daughter's college" },
          {
            path: 'category', label: 'Type', kind: 'select',
            options: [
              { value: 'retirement', label: 'Retirement' },
              { value: 'child_education', label: "Child's education" },
              { value: 'house_purchase', label: 'Buying a home' },
              { value: 'vehicle_purchase', label: 'Buying a vehicle' },
              { value: 'marriage', label: 'Marriage' },
              { value: 'higher_education_self', label: 'My own education' },
              { value: 'travel', label: 'Travel' },
              { value: 'business_start', label: 'Starting a business' },
              { value: 'wealth_creation', label: 'General wealth building' },
              { value: 'emergency_fund', label: 'Emergency fund' },
              { value: 'other', label: 'Something else' },
            ],
          },
          { path: 'requiredAmountToday', label: "Cost in today's money", kind: 'money' },
          { path: 'targetDate', label: 'When do you need it?', kind: 'date' },
          { path: 'amountAlreadySaved', label: 'Already saved towards it', kind: 'money', optional: true },
          { path: 'monthlyAmountCurrentlyInvested', label: 'Already investing monthly', kind: 'money', optional: true },
          {
            path: 'priority', label: 'How important?', kind: 'select',
            options: [
              { value: 'critical', label: 'Critical — must happen' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Nice to have' },
            ],
            help: 'Critical goals are funded first. Goals sharing a priority share the money between them.',
          },
        ],
      },
    ],
    fields: [
      {
        path: 'risk.investmentExperience', label: 'How much investing have you done?',
        kind: 'scale5', scaleLabels: ['None at all', 'A great deal'],
      },
      {
        path: 'risk.productKnowledge', label: 'How well do you understand investment products?',
        kind: 'scale5', scaleLabels: ['Not at all', 'Very well'],
      },
      {
        path: 'risk.preferredRiskLevel', label: 'What matters more to you?',
        kind: 'scale5', scaleLabels: ['Protecting what I have', 'Growing it as much as possible'],
      },
      {
        path: 'risk.maxAcceptableDrawdown', label: 'How large a temporary fall could you accept?',
        kind: 'percent', suffix: '%',
        help: 'If ₹10 lakh became ₹7 lakh for a year or two, that is a 30% fall. Answer with what you could actually hold through without selling — not what sounds brave.',
      },
      {
        path: 'risk.reactionToMarketDecline', label: 'Markets fall 30%. What do you actually do?',
        kind: 'scale5', scaleLabels: ['Sell everything', 'Invest more'],
      },
      {
        path: 'risk.abilityToHandleLosses', label: 'Could your finances absorb a real loss?',
        kind: 'scale5', scaleLabels: ['Not at all', 'Comfortably'],
      },
      { path: 'risk.investmentTimeHorizon', label: 'How long can you leave money invested?', kind: 'number', suffix: 'years' },
      {
        path: 'risk.needForGuaranteedCapital', label: 'Do you need your capital guaranteed?',
        kind: 'scale5', scaleLabels: ['Essential', 'Not needed'],
      },
      {
        path: 'risk.comfortWithVolatility', label: 'How comfortable are you watching values move?',
        kind: 'scale5', scaleLabels: ['Very uncomfortable', 'Completely fine'],
      },
    ],
    reassurance:
      'These questions cannot be skipped — a documented risk profile is a regulatory requirement, and it is what stops us recommending something you could not live with.',
  },

  /* ---------------------------------------------------------------- */
  {
    step: 8,
    title: 'Preferences, tax and consent',
    short: 'Preferences',
    intro: 'Last step. Preferences shape what we recommend; the tax details decide which regime saves you more.',
    fields: [
      {
        path: 'liquidity.acceptableLockInMonths', label: 'Longest you would accept money being locked away',
        kind: 'number', suffix: 'months',
        help: 'PPF locks for 15 years, ELSS for 3, NPS until you are 60. We will not suggest anything beyond your limit.',
      },
      { path: 'liquidity.largeExpensesWithin3Years', label: 'Large expenses expected within 3 years', kind: 'money', optional: true },
      {
        path: 'preferences.cryptoOptIn', label: 'Include a small crypto allocation?',
        kind: 'radio', options: yesNo,
        help: 'Capped at 5%, and only if your risk profile supports it. Gains are taxed at a flat 30%, losses cannot be offset against anything, and it sits outside SEBI regulation entirely. We model it at 0% expected return.',
      },
      {
        path: 'preferences.style', label: 'Index funds or actively managed?', kind: 'radio',
        options: [
          { value: 'passive', label: 'Index funds — lower cost' },
          { value: 'active', label: 'Actively managed' },
          { value: 'no_preference', label: 'No preference' },
        ],
      },
      {
        path: 'preferences.incomeOrGrowth', label: 'Regular income or long-term growth?', kind: 'radio',
        options: [
          { value: 'capital_growth', label: 'Growth' },
          { value: 'regular_income', label: 'Income' },
          { value: 'balanced', label: 'A bit of both' },
        ],
      },
      {
        path: 'tax.selectedRegime', label: 'Which tax regime are you on?', kind: 'select',
        options: [
          { value: 'undecided', label: "Not sure — work it out for me" },
          { value: 'new', label: 'New regime' },
          { value: 'old', label: 'Old regime' },
        ],
        help: 'We calculate both and tell you which is cheaper, with the rupee difference.',
      },
      { path: 'tax.annualEPFContribution', label: 'Annual EPF contribution', kind: 'money', optional: true },
      { path: 'tax.annualPPFContribution', label: 'Annual PPF contribution', kind: 'money', optional: true },
      { path: 'tax.annualLifeInsurancePremium', label: 'Annual life insurance premium', kind: 'money', optional: true },
      { path: 'tax.annualHealthInsurancePremium', label: 'Annual health insurance premium', kind: 'money', optional: true },
      { path: 'tax.annualHomeLoanInterestPaid', label: 'Annual home-loan interest', kind: 'money', optional: true },
      { path: 'tax.annualHomeLoanPrincipalRepaid', label: 'Annual home-loan principal', kind: 'money', optional: true },
      { path: 'tax.annualChildTuitionFees', label: 'Annual school or college fees', kind: 'money', optional: true },

      {
        path: 'consent.processFinancialInformation',
        label: 'I consent to FinManAI processing my financial information to prepare this plan.',
        kind: 'checkbox',
      },
      {
        path: 'consent.informationAccurate',
        label: 'I confirm the information I have given is accurate to the best of my knowledge.',
        kind: 'checkbox',
        help: 'The plan is only as good as what goes into it. This is not a formality.',
      },
      {
        path: 'consent.riskDisclosuresAccepted',
        label: 'I have read the risk disclosures and understand that investments carry risk, that returns are not guaranteed, and that past performance does not indicate future results.',
        kind: 'checkbox',
      },
      {
        path: 'consent.generatePersonalisedRecommendations',
        label: 'I consent to receiving personalised recommendations based on my profile.',
        kind: 'checkbox',
      },
      {
        path: 'consent.storeRecommendationHistory',
        label: 'I consent to my plans being stored for the required retention period.',
        kind: 'checkbox',
        help: 'Regulations require advisers to retain records for five years.',
      },
      {
        path: 'consent.remindersAndNotifications',
        label: 'Send me reminders, including my annual profile review.', kind: 'checkbox', optional: true,
      },
      { path: 'consent.nomineeName', label: 'Nominee name', kind: 'text', optional: true },
      { path: 'consent.emergencyContact', label: 'Emergency contact', kind: 'text', optional: true },
    ],
  },
];

export function stepDef(step: number): StepDef | undefined {
  return WIZARD.find((s) => s.step === step);
}

/** Read a dot path out of a nested object. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (cur, key) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

/** Write a dot path into a nested object, creating levels as needed. */
export function setPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const next = structuredClone(obj);
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return next;
}
