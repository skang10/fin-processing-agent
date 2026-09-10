import { describe, expect, it } from 'vitest';
import { sortQueueCases } from './queue-sort.js';

const cases = [
  { id: 'FD-2026-0010', name: 'Zoe', issues: 1, waitingSince: '2026-09-10T09:50:00Z' },
  { id: 'FD-2026-0002', name: 'Anna', issues: 3, waitingSince: '2026-09-10T09:30:00Z' },
  { id: 'FD-2026-0003', name: 'Emil', issues: 3, waitingSince: '2026-09-10T09:40:00Z' },
];

describe('sortQueueCases', function () {
  it('preserves the authoritative API order until a column is selected', function () {
    expect(sortQueueCases(cases, null).map(function (item) { return item.id; }))
      .toEqual(['FD-2026-0010', 'FD-2026-0002', 'FD-2026-0003']);
  });

  it('sorts case references naturally', function () {
    expect(sortQueueCases(cases, { key: 'case', direction: 'ascending' }).map(function (item) { return item.id; }))
      .toEqual(['FD-2026-0002', 'FD-2026-0003', 'FD-2026-0010']);
  });

  it('sorts numeric values and keeps ties stable', function () {
    expect(sortQueueCases(cases, { key: 'issues', direction: 'descending' }).map(function (item) { return item.id; }))
      .toEqual(['FD-2026-0002', 'FD-2026-0003', 'FD-2026-0010']);
  });

  it('sorts longest-waiting cases first', function () {
    expect(sortQueueCases(cases, { key: 'waiting', direction: 'descending' }).map(function (item) { return item.id; }))
      .toEqual(['FD-2026-0002', 'FD-2026-0003', 'FD-2026-0010']);
  });
});
