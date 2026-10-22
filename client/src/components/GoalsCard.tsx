import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DAILY_POINT_GOAL, GOAL_DEFAULTS, POINT_VALUES, incomePlan, type GoalInputs } from '../../../shared/playbook';

interface Tally { doors: number; contacted: number; presented: number; referrals: number; closed: number; points: number }
interface Goals { inputs: GoalInputs; plan: ReturnType<typeof incomePlan>; progress: { weekStart: string; week: Tally; today: Tally }; saved: boolean }

/**
 * The Income Goal Plan from the sales training, live: the rep types the
 * income they want, their average commission and close rate, and the card
 * turns it into sales, appointments and doors per week — then shows this
 * week's real numbers against it, plus today's score in the points game.
 */
export default function GoalsCard({ onOpenPlaybook }: { onOpenPlaybook?: (docId: string) => void }) {
  const [g, setG] = useState<Goals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<GoalInputs>(GOAL_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Goals>('/api/goals/me').then((r) => { setG(r); setDraft(r.inputs); }).catch((e: any) => setError(e?.message || 'Could not load your goals.'));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<Goals>('/api/goals/me', draft);
      setG((cur) => ({ ...(cur as Goals), ...r, progress: cur?.progress ?? r.progress }));
      setEdit(false);
    } catch (e: any) { setError(e?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const plan = edit ? incomePlan(draft) : g?.plan;
  const p = g?.progress;
  const money = (n: number) => `$${n.toLocaleString()}`;
  const num = (k: keyof GoalInputs, label: string, prefix = '', suffix = '') => (
    <label className="text-[11px] font-semibold text-gray-500">
      {label}
      <div className="flex items-center gap-1 mt-0.5">{prefix && <span className="text-sm text-gray-400">{prefix}</span>}
        <input type="number" inputMode="numeric" value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))} className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 font-normal" />
        {suffix && <span className="text-sm text-gray-400">{suffix}</span>}</div>
    </label>
  );
  const bar = (actual: number, target: number) => (
    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${actual >= target ? 'bg-emerald-500' : 'bg-navy'}`} style={{ width: `${Math.min(100, target ? (actual / target) * 100 : 0)}%` }} /></div>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">🎯 My goals</h3>
          <p className="text-xs text-gray-400">Your income goal, turned into the doors, appointments and sales it takes each week.</p>
        </div>
        <div className="flex gap-2">
          {onOpenPlaybook && <button onClick={() => onOpenPlaybook('income-goal-plan')} className="text-xs text-blue-600 hover:underline">How the plan works</button>}
          <button onClick={() => setEdit((v) => !v)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white font-medium text-gray-700">{edit ? 'Cancel' : g?.saved ? 'Edit goal' : 'Set my goal'}</button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!g && !error && <p className="text-sm text-gray-400">Loading…</p>}
        {edit && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {num('incomeGoal', 'Income goal this year', '$')}
            {num('avgCommission', 'Average commission per sale', '$')}
            {num('closeRate', 'Close rate', '', '%')}
            {num('sellingMonths', 'Selling months a year')}
            <div className="col-span-2 sm:col-span-4"><button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded-lg bg-navy text-white font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save my plan'}</button></div>
          </div>
        )}
        {g && plan && (
          <>
            {!g.saved && !edit && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">These are the default numbers ({money(GOAL_DEFAULTS.incomeGoal)} at {money(GOAL_DEFAULTS.avgCommission)} a sale). Set your own goal to make them yours.</p>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <Tile label="Sales a year" value={plan.salesPerYear} />
              <Tile label="Sales a month" value={plan.salesPerMonth} />
              <Tile label="Sales a week" value={plan.salesPerWeek} />
              <Tile label="Appointments a week" value={plan.apptsPerWeek} />
              <Tile label="Doors a day" value={plan.doorsPerDay} strong />
              <Tile label="Doors a week" value={plan.doorsPerWeek} />
              <Tile label="Letters a week" value={plan.lettersPerWeek} />
              <Tile label="Cold calls a week" value={plan.coldCallsPerWeek} />
            </div>
            <p className="text-[11px] text-gray-400">Plus each week: {plan.referralAsksPerWeek} referral asks, {plan.agentIntrosPerWeek} insurance-agent intros, {plan.networkingPerWeek} networking touches. {plan.touchesPerWeek} touches a week in all.</p>
            {p && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600">This week (from {p.weekStart})</p>
                  {[
                    { label: 'Doors knocked', actual: p.week.doors, target: plan.doorsPerWeek },
                    { label: 'Appointments run', actual: p.week.contacted, target: Math.ceil(plan.apptsPerWeek) },
                    { label: 'Sales closed', actual: p.week.closed, target: Math.ceil(plan.salesPerWeek) },
                  ].map((r) => (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs text-gray-700"><span>{r.label}</span><span className="tabular-nums">{r.actual} / {r.target}</span></div>
                      {bar(r.actual, r.target)}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs font-semibold text-gray-600">Today's points game</p>
                    <p className={`text-2xl font-bold tabular-nums ${p.today.points >= DAILY_POINT_GOAL ? 'text-emerald-600' : 'text-gray-900'}`}>{p.today.points}<span className="text-sm text-gray-400 font-normal"> / {DAILY_POINT_GOAL}</span></p>
                  </div>
                  {bar(p.today.points, DAILY_POINT_GOAL)}
                  <ul className="mt-2 text-[11px] text-gray-500 space-y-0.5">
                    <li>Closed sale = {POINT_VALUES.closed} · today {p.today.closed}</li>
                    <li>Appointment run or report presented = {POINT_VALUES.presented} · today {p.today.contacted + p.today.presented}</li>
                    <li>Door knocked = {POINT_VALUES.door} · today {p.today.doors}</li>
                    <li className="text-gray-400">Week so far: {p.week.points} points. {onOpenPlaybook && <button className="text-blue-600 hover:underline" onClick={() => onOpenPlaybook('daily-points-game')}>The rules</button>}</li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-2 ${strong ? 'bg-navy text-white' : 'bg-gray-50'}`}>
      <p className={`text-lg font-bold tabular-nums ${strong ? '' : 'text-gray-900'}`}>{Number.isInteger(value) ? value : value.toFixed(1)}</p>
      <p className={`text-[10px] ${strong ? 'text-blue-100' : 'text-gray-500'}`}>{label}</p>
    </div>
  );
}
