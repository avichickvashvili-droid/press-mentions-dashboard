// TableControls.jsx — the bar above the company table: the search box and, on the right, two
// icon buttons (owner, Prompt 331): Sort (Most mentions / Last mentioned / Company A–Z; choosing
// the current one again reverses it: Fewest mentions, oldest first, Z–A, Prompt 335) and
// Filter (All / Mentioned this week / Mentioned / No coverage, each with its count). Each opens
// a small menu with the current choice ticked. A choice that is not the default puts a dot on
// its icon and a small pill beside the icons ("Mentioned this week ×"); the pill's × goes back
// to the default. The sort pill is always shown (Prompt 335), with an × only when it is not
// the default.
//
// Where it sits: above the CompanyTable in App.jsx, which keeps all three choices in state.
// Reads/writes: nothing itself; it reports changes with the on... callbacks.

import { COMPANY_FILTERS } from '../../utils/companyFilters.js';
import { DEFAULT_SORT_CHOICE, isDefaultSortChoice, nextSortChoice, SORT_OPTIONS, sortChoiceLabel } from '../../utils/sortCompanies.js';
import { ActivePill, FilterIcon, IconMenu, SortIcon } from '../common/IconMenu.jsx';
import { CompanySearch } from '../CompanySearch/CompanySearch.jsx';
import styles from './TableControls.module.css';

const DEFAULT_FILTER = COMPANY_FILTERS[0].value;

// The label of a choice (or '' for an unknown value).
function labelOf(options, value) {
  return options.find((option) => option.value === value)?.label ?? '';
}

// `searchText` / `onSearch(text)`; `filter` / `filterCounts` / `onFilter(value)`;
// `sortChoice` / `onSort(choice)` (a { value, reversed } choice, utils/sortCompanies.js).
export function TableControls({ searchText, onSearch, filter, filterCounts, onFilter, sortChoice, onSort }) {
  const sortChanged = !isDefaultSortChoice(sortChoice);
  // The menu names the current choice in its direction; the others in their normal direction.
  const sortOptions = SORT_OPTIONS.map((option) => (option.value === sortChoice.value ? { ...option, label: sortChoiceLabel(sortChoice) } : option));
  const filterChanged = filter !== DEFAULT_FILTER;
  return (
    <div className={styles.controls}>
      <div className={styles.searchSlot}>
        <CompanySearch value={searchText} onChange={onSearch} />
      </div>
      <div className={styles.pills}>
        <ActivePill label={`Sort: ${sortChoiceLabel(sortChoice)}`} onRemove={sortChanged ? () => onSort(DEFAULT_SORT_CHOICE) : undefined} />
        {filterChanged && <ActivePill label={labelOf(COMPANY_FILTERS, filter)} onRemove={() => onFilter(DEFAULT_FILTER)} />}
      </div>
      <div className={styles.icons}>
        <IconMenu label="Sort" icon={<SortIcon />} active={sortChanged} sections={[{ options: sortOptions, value: sortChoice.value, reselect: true, onChange: (value) => onSort(nextSortChoice(sortChoice, value)) }]} />
        <IconMenu label="Filter companies" icon={<FilterIcon />} active={filterChanged} sections={[{ options: COMPANY_FILTERS, counts: filterCounts, value: filter, onChange: onFilter }]} />
      </div>
    </div>
  );
}
