// ErrorBoundary.jsx — the last safety net of the page: if drawing any part of the page fails
// (a bug), a short message is shown instead of a blank page.
//
// Where it sits: around the whole app, in src/main.jsx.
// Writes: the error to the browser console (for the developer).

import { Component } from 'react';
import styles from './common.module.css';

// React only offers this as a class component (getDerivedStateFromError / componentDidCatch).
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  // Switches to the fallback message once a child has thrown while drawing.
  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Keeps the details for the developer, in the browser console.
  componentDidCatch(error, info) {
    console.error('The dashboard page failed to draw:', error, info?.componentStack);
  }

  // The fallback message, or the page itself when nothing failed.
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.error} role="alert">
        <p>Something went wrong while showing the page. Reload the page to try again.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
