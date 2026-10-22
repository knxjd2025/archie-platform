import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportCaughtError } from '../lib/bug-monitor';

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * One thrown render used to blank the entire app — a white screen with no
 * explanation, on a phone, in a driveway. The client profile alone mounts
 * thirteen children, any of which can throw on unexpected API data.
 *
 * This catches that and keeps the app recoverable: the rep sees what happened
 * and can reload, and the error is logged where it can be read later rather
 * than vanishing with the component tree.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack is the part that actually identifies the culprit, so
    // it travels with the report to the Bugs page.
    console.error('[ui] render failed:', error, info.componentStack);
    reportCaughtError(error, 'render', { componentStack: info.componentStack?.slice(0, 4000) });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-md w-full">
          <h1 className="text-lg font-semibold text-gray-900">That screen hit a problem</h1>
          <p className="text-sm text-gray-600 mt-2">
            Nothing you entered has been sent anywhere. Reloading usually clears it. The details of this error were logged
            automatically — if it keeps happening, use “Report a bug” to say what you were doing.
          </p>
          <p className="text-xs text-gray-400 mt-3 font-mono break-words">{error.message}</p>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => window.location.reload()}
              className="text-sm px-4 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark"
            >
              Reload
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
            >
              Try again without reloading
            </button>
          </div>
        </div>
      </div>
    );
  }
}
