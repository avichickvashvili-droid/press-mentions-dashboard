// Ticker.jsx — the newest headlines scrolling slowly across the bottom of the hero (owner, Prompt
// 369: "the ticker is a banger", D118). Each headline opens its article in a new tab.
//
// Where it sits: in the Hero. Reads: the overview's `recent` mentions (props).
// The list is drawn twice in a row and moved left by half its length, so the loop has no jump.
// It pauses while the mouse is on it or a headline has the keyboard focus, and it does not move
// at all for viewers who asked for less motion (then it can be scrolled by hand). Screen readers
// read the list once (the copy is hidden from them).

import { isWebAddress } from '../../utils/links.js';
import styles from './Hero.module.css';

// How long one headline takes to pass, so a longer list scrolls at the same speed.
export const TICKER_SECONDS_PER_ITEM = 12;

// A headline without its " - Publisher" ending (the publisher is shown after it).
export function headlineOnly(title, publisher) {
  if (publisher && title.endsWith(` - ${publisher}`)) return title.slice(0, -(publisher.length + 3));
  return title;
}

// One headline: a sentiment dot, the company, the headline (a link) and the source.
function TickerItem({ mention, hidden }) {
  const words = headlineOnly(mention.title, mention.publisher);
  const content = (
    <>
      <span className={`${styles.tickDot} ${styles[`dot_${mention.sentiment}`] ?? ''}`} aria-hidden="true" />
      <b>{mention.companyName}</b> {words}
      {mention.publisher && <span className={styles.tickSource}> · {mention.publisher}</span>}
    </>
  );
  return isWebAddress(mention.url)
    ? <a className={styles.tickItem} href={mention.url} target="_blank" rel="noopener noreferrer" tabIndex={hidden ? -1 : undefined}>{content}</a>
    : <span className={styles.tickItem}>{content}</span>;
}

// `mentions` = the newest mentions (newest first).
export function Ticker({ mentions }) {
  const seconds = Math.max(30, mentions.length * TICKER_SECONDS_PER_ITEM);
  return (
    <div className={styles.ticker} aria-label="Latest headlines">
      <span className={styles.tickerTag}><span className={styles.liveDot} aria-hidden="true" />LATEST</span>
      <div className={styles.trackBox}>
        <div className={styles.track} style={{ animationDuration: `${seconds}s` }}>
          <div className={styles.run}>
            {mentions.map((m) => <TickerItem key={m.id} mention={m} />)}
          </div>
          <div className={styles.run} aria-hidden="true">
            {mentions.map((m) => <TickerItem key={`copy-${m.id}`} mention={m} hidden />)}
          </div>
        </div>
      </div>
    </div>
  );
}
