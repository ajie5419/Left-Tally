import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshotMatches } from './snapshot.mjs';

/** Runtime results must cover the required suites, not merely successful task labels. */
export function resultErrors(report) {
  const errors = [];
  try {
    if (
      report.environmentValid !== true ||
      report.phase !== 'CORE' ||
      report.node !== '24.21.0' ||
      report.pnpm !== '10.28.2' ||
      report.sourceHashFile !==
        'evidence/bootstrap/verify/source-sha256.json' ||
      !Array.isArray(report.sourceChangedDuringVerification) ||
      report.sourceChangedDuringVerification.length !== 0
    )
      errors.push('RESULT_ENVIRONMENT_OR_SOURCE_INVALID');
    const hashes = JSON.parse(readFileSync(report.sourceHashFile, 'utf8'));
    if (
      process.env.GITHUB_ACTIONS === 'true' &&
      (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ||
        report.gitCommit !== process.env.GITHUB_SHA ||
        report.requestedCICommit !== process.env.GITHUB_SHA)
    )
      errors.push('RESULT_CI_COMMIT_BINDING_INVALID');
    if (!snapshotMatches(hashes))
      errors.push('RESULT_SOURCE_SNAPSHOT_MISMATCH');
    for (const result of report.results ?? []) {
      if (!result.log || !existsSync(result.log))
        errors.push(`RESULT_LOG_MISSING: ${result.task}`);
    }
    const units = JSON.parse(
      readFileSync('evidence/bootstrap/unit-results.json', 'utf8'),
    );
    const assertions = units.testResults.flatMap(
      (suite) => suite.assertionResults,
    );
    if (
      !assertions.length ||
      assertions.some((item) => item.status !== 'passed') ||
      units.numPendingTests !== 0 ||
      units.numPassedTests !== assertions.length ||
      units.numTotalTests !== assertions.length
    )
      errors.push('RESULT_UNIT_FAILED_MISSING_OR_SKIPPED');
    const requiredUnits = JSON.parse(
      readFileSync('config/bootstrap.json', 'utf8'),
    ).suites.filter((path) => path.startsWith('tests/unit/'));
    for (const path of requiredUnits) {
      if (
        !units.testResults.some(
          (suite) =>
            suite.name === resolve(path) && suite.assertionResults.length,
        )
      )
        errors.push(`RESULT_UNIT_SUITE_MISSING: ${path}`);
    }
    const browser = JSON.parse(
      readFileSync('evidence/bootstrap/browser-results.json', 'utf8'),
    );
    if (
      browser.stats.expected !==
        JSON.parse(readFileSync('config/bootstrap.json', 'utf8'))
          .browserExpectedTests ||
      browser.stats.unexpected !== 0 ||
      browser.stats.skipped !== 0 ||
      browser.stats.flaky !== 0
    )
      errors.push('RESULT_BROWSER_FAILED_MISSING_OR_SKIPPED');
    const negative = JSON.parse(
      readFileSync('evidence/bootstrap/negative/results.json', 'utf8'),
    );
    const expected = JSON.parse(
      readFileSync('config/ci/expected-negatives.json', 'utf8'),
    );
    if (!negative.completed || !negative.passed || !negative.cleaned)
      errors.push('RESULT_NEGATIVE_INCOMPLETE');
    for (const id of expected) {
      const matches = negative.records.filter((record) => record.id === id);
      if (matches.length !== 1 || matches[0].valid !== true)
        errors.push(`RESULT_NEGATIVE_MISSING: ${id}`);
    }
    const probe = JSON.parse(
      readFileSync('evidence/bootstrap/database-probe.json', 'utf8'),
    );
    if (
      probe.exitCode !== 0 ||
      !probe.containersCreated ||
      !probe.databaseConnected ||
      !probe.probeVerified ||
      !probe.isolationVerified ||
      !probe.cleanupVerified ||
      !probe.portClosed ||
      probe.faultControl ||
      !probe.query.result[0].version.startsWith('8.4.') ||
      probe.query.result[0].engine !== 'InnoDB'
    )
      errors.push('RESULT_MYSQL_PROBE_INCOMPLETE');
    for (const [path, hash] of Object.entries(probe.sourceSha256 ?? {})) {
      if (hashes[path] !== hash)
        errors.push(`RESULT_PROBE_SOURCE_MISMATCH: ${path}`);
    }
    for (const path of [
      'scripts/database.mjs',
      'scripts/database-isolation.mjs',
      'scripts/database-backend.mjs',
      'config/database-probe.json',
    ]) {
      if (probe.sourceSha256?.[path] !== hashes[path])
        errors.push(`RESULT_PROBE_SOURCE_MISSING: ${path}`);
    }
    const migrations = JSON.parse(
      readFileSync('evidence/bootstrap/business-migrations.json', 'utf8'),
    );
    if (
      migrations.applicability !==
        'INITIAL_BUSINESS_SCHEMA_NO_PREVIOUS_BUSINESS_DELIVERY' ||
      migrations.migrationExecuted !== true ||
      migrations.schemaFound !== true ||
      migrations.previousDeliveryFound !== false
    )
      errors.push('RESULT_MIGRATION_APPLICABILITY_INVALID');
  } catch (error) {
    errors.push(`RESULT_EVIDENCE_MISSING_OR_INVALID: ${error.message}`);
  }
  return errors;
}
