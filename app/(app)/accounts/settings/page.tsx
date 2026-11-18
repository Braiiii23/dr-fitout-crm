import Link from "next/link";
import { prisma } from "@/lib/db";
import { accountsView } from "@/lib/accounts";
import { fmtAUD } from "@/lib/money";
import { requireUser } from "@/lib/auth";
import { saveAccountsSettings } from "../actions";

// Targets and the figures Xero can't supply. Everything on the Accounts page is worked out from these.
export default async function AccountsSettingsPage() {
  await requireUser(["ADMIN", "ACCOUNTS"]);
  const v = await accountsView();
  const s = (await prisma.accountsSettings.findUnique({ where: { id: "settings" } })) ?? (await prisma.accountsSettings.create({ data: { id: "settings" } }));
  const field = (name: string, label: string, value: string | number, hint: string, suffix = "") => (
    <label className="acc-field">
      <span className="label">{label}</span>
      <span className="acc-input-wrap"><input name={name} className="input" defaultValue={value} inputMode="decimal" />{suffix && <span className="acc-suffix">{suffix}</span>}</span>
      <span className="acc-hint">{hint}</span>
    </label>
  );
  return (
    <div className="acc space-y-5">
      <div><Link prefetch={false} href="/accounts" className="acc-link">Back to Accounts</Link></div>
      <h1 className="est-title">Targets &amp; settings</h1>
      <form action={saveAccountsSettings} className="space-y-5">
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Targets</h2>
          <div className="acc-fields">
            {field("monthlyTarget", "Sales goal per month", s.monthlyTarget, "Signed work. Shown on the dashboard and in the pipeline", "$")}
            {field("accountsTarget", "Turnover target for Accounts", s.accountsTarget, `0 = worked out from Xero: ${fmtAUD(Math.round(v.ideal.neededForNet)).replace(/\.00$/, "")} covers running costs + ${s.netMarginGoal}% net; last 6 months + 5% is ${fmtAUD(Math.round(v.ideal.stretch)).replace(/\.00$/, "")}. Using ${fmtAUD(v.ideal.target).replace(/\.00$/, "")}`, "$")}
            {field("grossMarginGoal", "Gross margin goal", s.grossMarginGoal, "Gross profit as a % of turnover", "%")}
            {field("netMarginGoal", "Net margin goal", s.netMarginGoal, "Profit after running costs", "%")}
            {field("quoteWinRate", "Quote win rate", s.quoteWinRate, "Share of quotes that sign. Replace with your real rate", "%")}
          </div>
        </section>
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Costs, cash and tax</h2>
          <div className="acc-fields">
            {field("runningCostsMonthly", "Running costs per month", s.runningCostsMonthly, s.useXeroFigures ? "Used until Xero has 3 complete months of history" : "Wages, rent, vehicles, insurance, software and the rest", "$")}
            {field("bufferAmount", "Safety buffer", s.bufferAmount, "The least you want in the bank", "$")}
            {field("avgJobSize", "Average job size", s.avgJobSize, "0 = work it out from signed jobs in the CRM", "$")}
            {field("companyTaxRate", "Company tax rate", s.companyTaxRate, "For the tax set-aside estimate", "%")}
            {field("staleDays", "Treat as 'check in Xero' after", s.staleDays, "Unpaid bills and invoices overdue longer than this are left out of the cash forecast", "days")}
          </div>
          <h3 className="est-h2" style={{ margin: "1.2rem 0 .6rem" }}>Claim invoices</h3>
          <div className="acc-fields">
            {field("claimTermsDays", "Payment terms on claims", s.claimTermsDays, "Days from invoice to due date", "days")}
            {field("claimNoticeDays", "Tell accounts ahead by", s.claimNoticeDays, "Days before a claim is due to be invoiced", "days")}
            <label className="acc-field"><span className="label">Send claim notices to</span><input name="claimNotifyEmail" className="input" defaultValue={s.claimNotifyEmail} /><span className="acc-hint">Comma-separate several addresses</span></label>
          </div>
          <h3 className="est-h2" style={{ margin: "1.2rem 0 .6rem" }}>Work on the books</h3>
          <div className="acc-fields">
            {field("workAlertMonths", "Warn when work covers less than", s.workAlertMonths, "Months of running costs covered by signed work", "mo")}
            {field("otherWorkOnHand", "Signed work not in the CRM", s.otherWorkOnHand, "Still to invoice, ex GST. Clear it once those jobs are in the CRM", "$")}
            {field("depositPct", "Deposit at signing", s.depositPct, "Share already invoiced once the deposit clears", "%")}
            {field("jobWeeks", "Typical job length", s.jobWeeks, "Weeks from signing to final claim, for the forecast", "wk")}
          </div>
          <label className="tp-check" style={{ marginTop: ".8rem" }}><input type="checkbox" name="forecastSecuredOnly" defaultChecked={s.forecastSecuredOnly} /> Forecast only work already won (recommended). Untick to assume last month&apos;s turnover carries on after 30 days</label>
          <label className="tp-check"><input type="checkbox" name="useXeroFigures" defaultChecked={s.useXeroFigures} /> Use Xero&apos;s real running costs (average of the last 3 complete months) once Xero has enough history</label>
          <label className="tp-check"><input type="checkbox" name="addRunningCostsToForecast" defaultChecked={s.addRunningCostsToForecast} /> Add running costs to the cash forecast each week (untick if all running costs are entered as bills in Xero)</label>
          <label className="tp-check"><input type="checkbox" name="forecastRecurringIncome" defaultChecked={s.forecastRecurringIncome} /> Beyond the next 30 days, assume work carries on at last month&apos;s turnover (with trade costs at your margin goal)</label>
        </section>
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Xero bank accounts</h2>
          <p className="acc-muted">Match accounts by part of their name or number, separated by commas.</p>
          <div className="acc-fields">
            <label className="acc-field"><span className="label">Counted as cash</span><input name="cashAccounts" className="input" defaultValue={s.cashAccounts} /><span className="acc-hint">e.g. 7637, 7645. Empty = every bank account</span></label>
            <label className="acc-field"><span className="label">Tax holding (not free to spend)</span><input name="holdingAccounts" className="input" defaultValue={s.holdingAccounts} /><span className="acc-hint">e.g. 7645, if that account holds GST and tax</span></label>
            <label className="acc-field"><span className="label">Credit cards</span><input name="creditAccounts" className="input" defaultValue={s.creditAccounts} /><span className="acc-hint">Shown as money owed, e.g. Amex</span></label>
          </div>
        </section>
        <div><button className="btn">Save settings</button>{s.updatedBy && <span className="acc-muted" style={{ marginLeft: ".75rem" }}>Last saved by {s.updatedBy}</span>}</div>
      </form>
    </div>
  );
}
