import type { SimConfig } from '../config';
import { collectBudget, loanPrincipal, settleLoans, type BudgetContext } from './budget';
import { hasDealConnection, settleDeals } from './region';
import type { CityState, DealResource } from './state';

export interface BudgetForecastOptions {
  /** One-off spending now, to compare a proposed investment without making it. */
  capitalSpend?: number;
  /** A hypothetical change in tax receipts at unchanged tax rates and population (0–10, default 1). */
  taxIncomeMultiplier?: number;
  /** Extra monthly operating cost; negative values are savings, capped at today's operating spending. */
  monthlyOperatingChange?: number;
}

export interface BudgetForecastPoint {
  /** Months ahead, starting at 1. */
  index: number;
  /** Simulation month of the settlement. */
  month: number;
  funds: number;
  income: number;
  expenses: number;
  balance: number;
  loanPayments: number;
  debt: number;
  neighbourIncome: number;
  neighbourExpense: number;
  troubledDeals: number;
}

export interface BudgetForecast {
  startFunds: number;
  capitalSpend: number;
  fundsAfterCapital: number;
  minimumFunds: number;
  /** 0 if capital spending is immediately unaffordable, otherwise the first negative settlement or null. */
  firstNegativeMonth: number | null;
  firstImpeachmentMonth: number | null;
  /** Deal ids whose contracts lapse in the projection. */
  endedDeals: number[];
  points: BudgetForecastPoint[];
}

/**
 * Static-city cash flow, with real loan maturities and deal grace/probation.
 * Taxes, operating costs, utility delivery, neighbours and unit prices stay
 * as they are today; growth, ageing and disasters are not advanced.
 * The expensive city budget is computed once, not once per forecast month.
 */
export function budgetForecast(s: CityState, cfg: SimConfig, ctx: BudgetContext, months: number, options: BudgetForecastOptions): BudgetForecast {
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new RangeError('forecast months must be a whole number from 1 to 120');
  if (typeof options !== 'object' || options === null) throw new RangeError('invalid forecast options');
  const capital = options.capitalSpend ?? 0;
  const taxes = options.taxIncomeMultiplier ?? 1;
  const operatingChange = options.monthlyOperatingChange ?? 0;
  if (!Number.isFinite(capital) || capital < 0 || capital > Number.MAX_SAFE_INTEGER
    || !Number.isFinite(taxes) || taxes < 0 || taxes > 10
    || !Number.isFinite(operatingChange) || Math.abs(operatingChange) > Number.MAX_SAFE_INTEGER) throw new RangeError('invalid forecast scenario');
  const at: CityState = {
    ...s, funds: s.funds - capital,
    loans: s.loans.map((loan) => ({ ...loan })), neighbourDeals: s.neighbourDeals.map((deal) => ({ ...deal })),
  };
  const result: BudgetForecast = {
    startFunds: s.funds, capitalSpend: capital, fundsAfterCapital: at.funds, minimumFunds: at.funds,
    firstNegativeMonth: at.funds < 0 ? 0 : null,
    firstImpeachmentMonth: at.funds <= cfg.economy.impeachmentFunds ? 0 : null,
    endedDeals: [], points: [],
  };
  // The projection never edits networks or neighbour borders. Check each
  // standing connection once, rather than scan every edge in every month.
  const connections = new Map<string, boolean>();
  for (const deal of at.neighbourDeals) {
    const key = `${deal.edge}:${deal.resource}`;
    if (!connections.has(key)) connections.set(key, hasDealConnection(at, deal.edge, deal.resource));
  }
  const connected = (edge: number, resource: DealResource) => connections.get(`${edge}:${resource}`) ?? false;
  const first = collectBudget(at, cfg, { ...ctx, connected, month: ctx.month + 1 });
  result.endedDeals.push(...first.ended.map((deal) => deal.id));
  const base = first.report;
  const taxBase = Object.values(base.taxByType).reduce((sum, value) => sum + value, 0);
  const staticIncome = base.income - base.neighbourIncome + taxBase * (taxes - 1);
  const staticExpenses = Math.max(0, base.expenses - base.loanPayments - base.neighbourExpense + operatingChange);
  for (let index = 1; index <= months; index++) {
    let loanPayments: number;
    let neighbourIncome: number;
    let neighbourExpense: number;
    if (index === 1) {
      loanPayments = base.loanPayments;
      neighbourIncome = base.neighbourIncome;
      neighbourExpense = base.neighbourExpense;
      // collectBudget already settled the first month at the unmodified tax base and costs.
      at.funds = result.fundsAfterCapital;
    } else {
      const deals = settleDeals(at, cfg, ctx.delivered, connected, ctx.deliveredByDeal);
      neighbourIncome = deals.income;
      neighbourExpense = deals.expense;
      result.endedDeals.push(...deals.ended.map((deal) => deal.id));
      loanPayments = settleLoans(at);
    }
    const income = staticIncome + neighbourIncome;
    const expenses = staticExpenses + loanPayments + neighbourExpense;
    const balance = income - expenses;
    at.funds += balance;
    result.minimumFunds = Math.min(result.minimumFunds, at.funds);
    if (result.firstNegativeMonth === null && at.funds < 0) result.firstNegativeMonth = index;
    if (result.firstImpeachmentMonth === null && at.funds <= cfg.economy.impeachmentFunds) result.firstImpeachmentMonth = index;
    result.points.push({
      index, month: ctx.month + index, funds: at.funds, income, expenses, balance, loanPayments,
      debt: at.loans.reduce((sum, loan) => sum + loanPrincipal(cfg, loan), 0),
      neighbourIncome, neighbourExpense, troubledDeals: at.neighbourDeals.filter((deal) => deal.status !== 'active').length,
    });
  }
  return result;
}
