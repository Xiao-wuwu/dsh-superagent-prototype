// The plain-language layer over the admission table: what it can ask, and what writing an answer costs the table.
import { expect, it } from 'vitest'
import {
  ADMISSION_CELLS, ADMISSION_DEFAULTS, ADMISSION_OPTIONS, AUTO_CELLS, RECORD_CELLS,
  admissionOf, cellAdmission, plainOf, plainOptions, plainQuestions, withCellAdmission,
  type Admission, type AdmissionCell,
} from '../src/admission.ts'
import type { AdmissionRowView } from '../src/sources/kind.ts'

const row = (id: string, cells: Partial<Record<AdmissionCell, boolean>>): AdmissionRowView =>
  ({ id, label: id, note: { zh: '', en: '' }, cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: false, ...cells } })

it('covers every cell in exactly one group, taken from the values each cell may hold', () => {
  const auto = ADMISSION_CELLS.filter(cell => (ADMISSION_OPTIONS[cell] as readonly Admission[]).includes('explicit'))
  const record = ADMISSION_CELLS.filter(cell => !auto.includes(cell))
  expect(AUTO_CELLS).toEqual(auto)
  expect(RECORD_CELLS).toEqual(record)
  expect([...AUTO_CELLS, ...RECORD_CELLS].sort()).toEqual([...ADMISSION_CELLS].sort())
  expect(AUTO_CELLS.filter(cell => RECORD_CELLS.includes(cell))).toEqual([])
  // A cell that cannot hold an explicit request is never offered as one that opens work by itself.
  expect(ADMISSION_CELLS.filter(cell => plainOptions(cell).includes('auto') !== AUTO_CELLS.includes(cell))).toEqual([])
})

it('words each value of a cell once, in the order of the values themselves', () => {
  for (const cell of ADMISSION_CELLS) {
    const choices = plainOptions(cell)
    expect(choices).toHaveLength(ADMISSION_OPTIONS[cell].length)
    expect(new Set(choices).size).toBe(choices.length)
    expect(choices.map(admissionOf).sort()).toEqual([...(ADMISSION_OPTIONS[cell] as readonly Admission[])].sort())
  }
})

it('round-trips every choice through the table without leaving the cell it wrote', () => {
  const start = withCellAdmission({}, 'r1', 'listedUnaddressed', 'ignore')
  for (const cell of ADMISSION_CELLS) {
    for (const choice of plainOptions(cell)) {
      const next = withCellAdmission(start, 'r1', cell, admissionOf(choice))
      expect(plainOf(cellAdmission(next, 'r1', cell))).toBe(choice)
      expect(cellAdmission(next, 'r1', cell)).toBe(admissionOf(choice))
    }
  }
  // Writing one row and cell leaves the other row, the default of the other cells, and the cell already set intact.
  const wide = withCellAdmission(withCellAdmission(start, 'r2', 'unlistedAddressed', 'explicit'), 'r1', 'unlistedUnaddressed', 'ignore')
  expect(wide).toEqual({ r1: { listedUnaddressed: 'ignore', unlistedUnaddressed: 'ignore' }, r2: { unlistedAddressed: 'explicit' } })
  expect(cellAdmission(wide, 'r2', 'listedUnaddressed')).toBe(ADMISSION_DEFAULTS.listedUnaddressed)
  expect(Object.keys(wide).sort()).toEqual(['r1', 'r2'])
})

it('asks only the questions a scope can receive, and never a stronger one than the cell allows', () => {
  const rows = [row('all', { listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: true }),
    row('mention', { unlistedAddressed: true }), row('none', {})]
  const questions = plainQuestions(rows)
  const receivable = rows.flatMap(item => ADMISSION_CELLS.filter(cell => item.cells[cell]).map((cell): [string, AdmissionCell] => [item.id, cell]))
  const asked = [...questions.auto, ...questions.record].map(item => [item.row, item.cell] as [string, AdmissionCell])
  expect(asked.sort()).toEqual(receivable.sort())
  expect(questions.auto.map(item => [item.row, item.cell])).toEqual([['all', 'unlistedAddressed'], ['mention', 'unlistedAddressed']])
  expect(questions.record.map(item => [item.row, item.cell])).toEqual([['all', 'listedUnaddressed'], ['all', 'unlistedUnaddressed']])
  expect(questions.record.filter(item => plainOptions(item.cell).includes('auto'))).toEqual([])
  expect(plainQuestions([])).toEqual({ auto: [], record: [] })
})
