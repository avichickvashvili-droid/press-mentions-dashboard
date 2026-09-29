// ErrorMessage.jsx — a readable error with a "Try again" button.
//
// Where it sits: shown by App.jsx and MentionsPanel when loading failed. The message comes from
// src/api/client.js (already written for a person).

import styles from './common.module.css';

// Shows the message; the button (only when `onRetry` is given) loads the data again.
export function ErrorMessage({ message, onRetry }) {
  return (
    <div className={styles.error} role="alert">
      <p>{message}</p>
      {onRetry && <button type="button" onClick={() => onRetry()}>Try again</button>}
    </div>
  );
}
