// Convention check — the counts this repo quotes about itself must match the register.
//
// BUGS.md is the source of truth: every defect is one `## BUG-NN` heading, and a heading
// carrying ⚠️ PARTIALLY OPEN is the only kind that is not closed. Prose elsewhere quotes
// those numbers, nothing regenerates it, and prose does not fail a build — so three
// different counts (12, 18, 20) had drifted apart against a register holding 21.
//
// Usage:
//   npm run check:conventions

import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const failures: { rule: string; message: string }[] = []
const fail = (rule: string, message: string) => failures.push({ rule, message })

// ─── The register ─────────────────────────────────────────────────────────────

const bugs = read('BUGS.md')
const headings = [...bugs.matchAll(/^## BUG-(\d+)\b(.*)$/gm)]

const total = headings.length
const partiallyOpen = headings.filter((h) => /PARTIALLY OPEN/i.test(h[2]!)).length
const closed = total - partiallyOpen

// Numbering: BUG-01…BUG-NN with no gaps and no duplicates. A gap usually means an entry was
// deleted rather than marked resolved, which is how a register quietly stops being a record.
const ids = headings.map((h) => Number(h[1]))
const expected = Array.from({ length: total }, (_, i) => i + 1)
if (ids.join(',') !== expected.join(',')) {
    fail(
        'register-numbering',
        `BUGS.md headings are ${ids.join(', ')} — expected BUG-01…BUG-${String(total).padStart(2, '0')} with no gaps or duplicates`,
    )
}

// ─── Prose that quotes those numbers ──────────────────────────────────────────

// Each entry: file, a regex with one capturing group, and what the group should equal.
const claims: { file: string; re: RegExp; expect: number; what: string }[] = [
    { file: 'README.md', re: /\|\s*\*\*Defects\*\*\s*\|\s*(\d+) written up in/, expect: total, what: 'facts card' },
    { file: 'README.md', re: /^(\d+) real bugs found during implementation/m, expect: total, what: 'Bug Cemetery' },
    { file: 'BACKLOG.md', re: /\|\s*`BUGS\.md`\s*\|\s*(\d+) defects with root cause/, expect: total, what: 'doc index' },
    { file: 'docs/GETTING-STARTED.md', re: /`BUGS\.md` contains (\d+) real bugs/, expect: total, what: 'intro' },
    { file: 'docs/GETTING-STARTED.md', re: /Read all (\d+) entries/, expect: total, what: 'call to read' },
    { file: 'docs/GETTING-STARTED.md', re: /\|\s*`BUGS\.md`\s*\|\s*(\d+) real bugs/, expect: total, what: 'key files table' },
]

for (const { file, re, expect, what } of claims) {
    const found = read(file).match(re)
    if (!found) {
        fail('claim-missing', `${file} no longer states its ${what} count in the expected wording — update the check or restore the phrasing`)
    } else if (Number(found[1]) !== expect) {
        fail('claim-count', `${file} (${what}) says ${found[1]}, BUGS.md holds ${expect}`)
    }
}

// The ROI block quotes the split, not just the total.
const roi = read('README.md').match(/Real defects:\s+(\d+)\s+\(see BUGS\.md — (\d+) closed, (\d+) partially open/)
if (!roi) {
    fail('roi-missing', "README.md no longer states 'Real defects: N (see BUGS.md — N closed, N partially open' — update the check or restore the phrasing")
} else {
    const [, quotedTotal, quotedClosed, quotedOpen] = roi.map(Number) as [number, number, number, number]
    if (quotedTotal !== total) fail('roi-total', `Testing ROI says ${quotedTotal} defects, BUGS.md holds ${total}`)
    if (quotedClosed !== closed) fail('roi-closed', `Testing ROI says ${quotedClosed} closed, BUGS.md has ${closed}`)
    if (quotedOpen !== partiallyOpen) fail('roi-open', `Testing ROI says ${quotedOpen} partially open, BUGS.md has ${partiallyOpen}`)
}

// ─── Report ───────────────────────────────────────────────────────────────────

if (failures.length) {
    console.error('\nConvention check failed:\n')
    for (const f of failures) console.error(`  [${f.rule}] ${f.message}\n`)
    console.error('A claim this repo makes about itself is no longer true. Fix the prose, or the register it quotes.\n')
    process.exit(1)
}

console.log(`Convention check passed — ${total} defects (${closed} closed, ${partiallyOpen} partially open) quoted consistently.`)
