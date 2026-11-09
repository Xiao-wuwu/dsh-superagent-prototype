/**
 * Per-scope admission matrix classifying incoming messages as explicit requests, inferred candidates, or ignored.
 * A listed sender who addresses the agent always makes an explicit request (no table cell); an unaddressed message cannot be explicit.
 */
import type { AdmissionCell } from './core/model.ts'

export type { AdmissionCell }
export type Admission = 'explicit' | 'inferred' | 'ignore'
export const ADMISSION_OPTIONS = { listedUnaddressed: ['inferred', 'ignore'], unlistedAddressed: ['explicit', 'inferred', 'ignore'],
  unlistedUnaddressed: ['inferred', 'ignore'] } as const satisfies Record<AdmissionCell, readonly Admission[]>
export type AdmissionRow = { [C in AdmissionCell]?: typeof ADMISSION_OPTIONS[C][number] }
/** Default admission rules (matching pre-table behavior): unaddressed messages from listed senders are inferred candidates; unlisted senders are ignored. */
export const ADMISSION_DEFAULTS: Readonly<Record<AdmissionCell, Admission>> = { listedUnaddressed: 'inferred', unlistedAddressed: 'ignore', unlistedUnaddressed: 'ignore' }
/** The cells of one row, in table order, taken from the options so a new cell needs no second list. */
export const ADMISSION_CELLS = Object.keys(ADMISSION_OPTIONS) as AdmissionCell[]

/**
 * How a person words the same three outcomes when the table is not on screen: a message either opens work, leaves a
 * record of itself, or goes unnoticed. `auto` is available exactly where an explicit request is possible.
 */
export type PlainChoice = 'auto' | 'record' | 'drop'
const PLAIN_VALUES: Record<PlainChoice, Admission> = { auto: 'explicit', record: 'inferred', drop: 'ignore' }
export const plainOf = (admission: Admission): PlainChoice => admission === 'explicit' ? 'auto' : admission === 'inferred' ? 'record' : 'drop'
export const admissionOf = (choice: PlainChoice): Admission => PLAIN_VALUES[choice]
/** The choices a cell offers in plain words, in the order of its underlying values. */
export const plainOptions = (cell: AdmissionCell): PlainChoice[] => (ADMISSION_OPTIONS[cell] as readonly Admission[]).map(plainOf)
const isAutoCell = (cell: AdmissionCell): boolean => (ADMISSION_OPTIONS[cell] as readonly Admission[]).includes('explicit')
/** The questions whose answer can open work on its own; the rest ask nothing of a person beyond a recorded candidate. */
export const AUTO_CELLS: readonly AdmissionCell[] = ADMISSION_CELLS.filter(isAutoCell)
export const RECORD_CELLS: readonly AdmissionCell[] = ADMISSION_CELLS.filter(cell => !isAutoCell(cell))

/** One row of the table as stored under a Source's policy part: only what a person changed, so defaults stay in one place. */
export type AdmissionTable = Record<string, Partial<Record<AdmissionCell, Admission>>>
/** The value of `cell` of `row`, defaulting a scope that was never configured to the pre-table behavior. */
export const cellAdmission = (table: AdmissionTable, row: string, cell: AdmissionCell): Admission => table[row]?.[cell] ?? ADMISSION_DEFAULTS[cell]
/** Write one cell, leaving every other row and cell untouched. */
export const withCellAdmission = (table: AdmissionTable, row: string, cell: AdmissionCell, value: Admission): AdmissionTable =>
  ({ ...table, [row]: { ...table[row], [cell]: value } })
/** One question the plain form asks: a receiving scope and one cell of it. */
export interface PlainQuestion { row: string; cell: AdmissionCell }
/**
 * Split the cells a set of scopes can actually receive into the two groups a person reads, dropping the cells a scope
 * does not receive at all, so the form never asks an unanswerable question.
 */
export function plainQuestions(rows: readonly { id: string; cells: Record<AdmissionCell, boolean> }[]): { auto: PlainQuestion[]; record: PlainQuestion[] } {
  const questions = rows.flatMap(row => ADMISSION_CELLS.filter(cell => row.cells[cell]).map((cell): PlainQuestion => ({ row: row.id, cell })))
  return { auto: questions.filter(item => isAutoCell(item.cell)), record: questions.filter(item => !isAutoCell(item.cell)) }
}
