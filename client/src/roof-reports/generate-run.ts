/**
 * Making a report, as one run with everything it touches handed in, so it is
 * tested in Node with fakes: start (or retry), put up with one failed ask,
 * ask again with growing waits, and stop at ready, at "could not finish" or at
 * "taking long". The step draws what it reports through `onState`.
 *
 * Why an error from the first call is not believed: the call lasts until the
 * report ends, so a dropped connection, a refresh or a timeout says nothing
 * about whether the report was started. Sending the same request with the same
 * key again either starts it or returns the report the server already made, and
 * never starts a second one.
 */
import {
  POLL_FAILS_ALLOWED, POLL_GIVE_UP_MS, failureView, nextPollDelayMs, outcomeOf, readAnswer, refusalSentence, type FailureView, type GenerateBody,
  type ReportAnswer,
} from './generate-flow';
import { RR } from './words';

export type FlowState =
  | { phase: 'making'; reportId: string | null }
  | { phase: 'ready'; reportId: string; problem: string | null }
  | { phase: 'failed'; reportId: string | null; view: FailureView }
  | { phase: 'slow'; reportId: string | null }
  | { phase: 'cancelled' };

export interface RunDeps {
  /** POST /api/roof-reports/generate with the attempt's key. */
  generate(body: GenerateBody, key: string): Promise<unknown>;
  /** POST /api/roof-reports/:id/retry. */
  retry(id: string): Promise<unknown>;
  /** GET /api/roof-reports/:id. */
  status(id: string): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** The screen has gone; stop asking. */
  cancelled(): boolean;
}

export interface RunInput {
  mode: 'start' | 'retry';
  body: GenerateBody;
  key: string;
  /** The report's id when it is known (a retry always has it). */
  id: string | null;
}

type Asked = { answer: ReportAnswer } | { error: unknown };

async function ask(fn: () => Promise<unknown>): Promise<Asked> {
  try {
    const value = await fn();
    const answer = readAnswer(value);
    if (answer) return { answer };
    return { error: new Error(refusalSentence(value) ?? RR.generate.couldNotFinish) };
  } catch (error) {
    return { error };
  }
}

const failed = (reportId: string | null, view: FailureView): FlowState => ({ phase: 'failed', reportId, view });

export async function runGeneration(deps: RunDeps, input: RunInput, onState: (state: FlowState) => void): Promise<FlowState> {
  onState({ phase: 'making', reportId: input.id });

  let asked = await ask(() => (input.mode === 'retry' && input.id ? deps.retry(input.id) : deps.generate(input.body, input.key)));
  if ('error' in asked) {
    const view = failureView(asked.error);
    // These say the same thing however often they are asked: the cap, a wrong address, too many too fast.
    if (view.kind === 'capped' || view.kind === 'address' || view.kind === 'wait') return failed(input.id, view);
    if (deps.cancelled()) return { phase: 'cancelled' };
    asked = await ask(() => (input.mode === 'retry' && input.id ? deps.status(input.id) : deps.generate(input.body, input.key)));
    if ('error' in asked) return failed(input.id, failureView(asked.error));
  }

  let answer = asked.answer;
  const id = answer.id;
  const startedAt = deps.now();
  let polls = 0;
  let missed = 0;
  for (;;) {
    const outcome = outcomeOf(answer);
    if (outcome === 'ready') return { phase: 'ready', reportId: id, problem: answer.problem };
    if (outcome === 'failed') return failed(id, failureView({ message: answer.problem ?? '' }));
    onState({ phase: 'making', reportId: id });
    if (deps.cancelled()) return { phase: 'cancelled' };
    if (deps.now() - startedAt >= POLL_GIVE_UP_MS) return { phase: 'slow', reportId: id };
    await deps.sleep(nextPollDelayMs(polls++));
    if (deps.cancelled()) return { phase: 'cancelled' };
    const next = await ask(() => deps.status(id));
    if ('answer' in next) { answer = next.answer; missed = 0; } else if (++missed >= POLL_FAILS_ALLOWED) return { phase: 'slow', reportId: id };
  }
}
