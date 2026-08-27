/**
 * The model every script in this directory asks, in one place.
 *
 * Before 2026-08-27 the id was a literal in six files — `llm-oracle`, `meta-oracle`, `chaos-agent`,
 * `semantic-mutations`, `spec-to-test`, `ci-summary`. Six literals are not six decisions: they are
 * one decision copied five times, and a copy is where drift starts. The portfolio had twenty of
 * them across four repositories, and two copies inside one repository had already diverged in a way
 * nothing caught (see `aiServiceParity.test.js` in the SUT).
 *
 * A dated snapshot, not the `claude-haiku-4-5` alias: these scripts produce numbers that get written
 * into BUGS.md and compared across weeks — `semantic-mutations` counts survivors, `llm-oracle` rules
 * on turn traces. A model id that silently follows Anthropic's latest snapshot would make those
 * comparisons meaningless without anything visible changing here.
 *
 * These are oracles over the engine, not over a model, so the defendant is this repository's code.
 * That is why the id stays on the cheap model rather than moving to a stronger judge the way the
 * SUT suite's LLM judge did: raising it here would change thresholds that were calibrated against
 * this one, which is a re-calibration exercise, not a configuration change.
 */
export const ORACLE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001'
