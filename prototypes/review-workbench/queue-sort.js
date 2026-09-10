const textCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export const defaultSortDirections = Object.freeze({
  case: 'ascending',
  applicant: 'ascending',
  method: 'ascending',
  issues: 'descending',
  status: 'ascending',
  waiting: 'descending',
});

export function sortQueueCases(cases, sort) {
  if (!sort) return [...cases];
  const direction = sort.direction === 'descending' ? -1 : 1;
  return cases.map(function (item, index) { return { item, index }; }).sort(function (left, right) {
    const compared = compareValues(valueFor(left.item, sort.key), valueFor(right.item, sort.key));
    return compared === 0 ? left.index - right.index : compared * direction;
  }).map(function (entry) { return entry.item; });
}

function valueFor(item, key) {
  if (key === 'case') return item.id;
  if (key === 'applicant') return item.name;
  if (key === 'method') return `${item.methodTitle ?? ''} ${item.methodDetail ?? ''}`;
  if (key === 'issues') return item.issues;
  if (key === 'status') return item.statusLabel;
  if (key === 'waiting') {
    const timestamp = Date.parse(item.waitingSince);
    return Number.isNaN(timestamp) ? 0 : Date.now() - timestamp;
  }
  return '';
}

function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return textCollator.compare(String(left ?? ''), String(right ?? ''));
}
