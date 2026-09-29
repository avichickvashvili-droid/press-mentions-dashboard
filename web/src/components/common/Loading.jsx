// Loading.jsx — "Loading ..." while data is on its way.
//
// Where it sits: shown by App.jsx (company list) and MentionsPanel (mentions).

import styles from './common.module.css';

// Shows the given text (default "Loading ...").
export function Loading({ text = 'Loading ...' }) {
  return <p className={styles.loading} role="status">{text}</p>;
}
