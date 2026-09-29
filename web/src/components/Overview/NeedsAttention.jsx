// NeedsAttention.jsx — "Needs attention" (D117): the companies worth a look this week, picked by
// the api (GET /api/overview `attention`): a negative week, a spike, gone quiet, or a very
// positive week. Each has a coloured mark, one line of why, a 14-day mini chart and the key number.
// A row opens the company.
//
// Where it sits: in OverviewPage, beside Top companies. Reads: its props only.

import { attentionWords } from '../../utils/overview.js';
import { CompanyLogo } from '../CompanyLogo/CompanyLogo.jsx';
import { Sparkline } from './visuals.jsx';
import styles from './Overview.module.css';

// The look of each kind: the mark's colour and symbol, and the mini chart's colour.
const KINDS = {
  negative: { tone: 'negative', mark: '!', spark: 'negative', title: 'Negative week' },
  spike: { tone: 'accent', mark: '↑', spark: 'accent', title: 'Mention spike' },
  quiet: { tone: 'amber', mark: '…', spark: 'muted', title: 'Went quiet' },
  positive: { tone: 'positive', mark: '★', spark: 'positive', title: 'Very positive week' },
};

// `items` = the overview's attention list; `onOpen(id)` opens a company.
export function NeedsAttention({ items, onOpen }) {
  return (
    <section className={`${styles.card} ${styles.listCard}`} aria-label="Needs attention">
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Needs attention</h2>
          <p className={styles.cardSub}>This week (7 days) vs before · picked automatically</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className={styles.empty}>Nothing unusual this week.</p>
      ) : (
        <ul className={styles.attention}>
          {items.map((item) => {
            const kind = KINDS[item.kind] ?? KINDS.spike;
            const words = attentionWords(item);
            return (
              <li key={item.companyId}>
                <button type="button" className={`${styles.attentionItem} ${styles[`edge${kind.tone}`]}`} onClick={() => onOpen(item.companyId)} aria-label={`${item.name}: ${kind.title}. ${words.detail}`}>
                  <span className={`${styles.mark} ${styles[kind.tone]}`} aria-hidden="true">{kind.mark}</span>
                  <CompanyLogo name={item.name} logoUrl={item.logoUrl} />
                  <span className={styles.attentionText}>
                    <span className={styles.attentionName}>{item.name}<span className={styles.kindTag}>{kind.title}</span></span>
                    <span className={styles.attentionDetail}>{words.detail}</span>
                  </span>
                  <Sparkline values={item.spark} tone={kind.spark} width={96} height={30} />
                  <span className={styles.attentionValue}>
                    <b className={styles[`text${kind.tone}`]}>{words.badge}</b>
                    <small>{words.badgeNote}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
