import { describe, expect, it } from 'vitest';
import { csvCell, csvFilename, toCsv } from '@/lib/csv';

// The admin CSV exports carry member-supplied text (names, emails, payment
// descriptions) into a file the gym owner opens in Excel or Google Sheets.
// These tests pin the two things that go wrong there: a cell that breaks the
// row apart, and a cell the spreadsheet decides to EXECUTE.

describe('csvCell — RFC 4180 quoting', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Ada Lovelace')).toBe('Ada Lovelace');
    expect(csvCell(1500)).toBe('1500');
  });

  it('renders null/undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a value containing a comma, so the row keeps its shape', () => {
    expect(csvCell('Okafor, Ada')).toBe('"Okafor, Ada"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('Ada "Countess" Lovelace')).toBe('"Ada ""Countess"" Lovelace"');
  });

  it('quotes a value containing a newline', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });
});

describe('csvCell — spreadsheet formula injection', () => {
  // A member can choose their own name. Without this, the owner opening the
  // export gets a live formula from a member-controlled string.
  it('neutralises every formula-triggering leading character', () => {
    for (const lead of ['=', '+', '-', '@']) {
      const out = csvCell(`${lead}HYPERLINK("http://evil","click")`);
      expect(out.startsWith('"\t') || out.startsWith('\t')).toBe(true);
      expect(out).not.toMatch(new RegExp(`^\\${lead}`));
    }
  });

  it('neutralises a classic command-execution payload', () => {
    const out = csvCell('=cmd|\' /C calc\'!A0');
    expect(out).not.toMatch(/^=/);
    expect(out).toContain('\t=cmd');
  });

  it('neutralises a leading tab or carriage return', () => {
    expect(csvCell('\t=1+1')).toMatch(/^"?\t/);
    expect(csvCell('\r=1+1')).toMatch(/^"?\t/);
  });

  it('does not mangle a legitimate negative number beyond making it inert', () => {
    // A leading '-' is a formula trigger, so it IS prefixed — the value stays
    // readable in the sheet, which is the trade-off this control accepts.
    const out = csvCell('-500');
    expect(out).toContain('-500');
    expect(out.startsWith('\t')).toBe(true);
  });

  it('leaves a formula character in the MIDDLE of a value alone', () => {
    expect(csvCell('Ada=Lovelace')).toBe('Ada=Lovelace');
  });
});

describe('toCsv', () => {
  it('joins a header and rows into a document', () => {
    expect(toCsv(['Name', 'Amount'], [['Ada', 1500], ['Bo', 2000]]))
      .toBe('Name,Amount\nAda,1500\nBo,2000');
  });

  it('escapes every cell it writes', () => {
    expect(toCsv(['Name'], [['Okafor, Ada']])).toBe('Name\n"Okafor, Ada"');
  });

  it('handles an empty row set (header only)', () => {
    expect(toCsv(['Name'], [])).toBe('Name');
  });
});

describe('csvFilename', () => {
  const day = new Date('2026-08-02T09:30:00Z');

  it('builds prefix-slug-date.csv', () => {
    expect(csvFilename('members', 'Iron Republic', day)).toBe('members-iron-republic-2026-08-02.csv');
  });

  it('reduces a hostile gym name to a header-safe slug', () => {
    // A quote or CRLF here would break the Content-Disposition header.
    const name = 'Iron"; drop\r\nX-Evil: 1';
    const out = csvFilename('members', name, day);
    expect(out).not.toMatch(/["\r\n]/);
    expect(out).toMatch(/^members-[a-z0-9-]*-2026-08-02\.csv$/);
  });

  it('falls back to "gym" when the name is missing or has no usable characters', () => {
    expect(csvFilename('members', null, day)).toBe('members-gym-2026-08-02.csv');
    expect(csvFilename('members', '!!!', day)).toBe('members-gym-2026-08-02.csv');
  });
});
