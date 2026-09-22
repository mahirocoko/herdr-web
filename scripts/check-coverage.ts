import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MIN_LINE_COVERAGE_PERCENT = 55
const MIN_FUNCTION_COVERAGE_PERCENT = 75

interface ICoverageMetric {
  covered: number
  total: number
  percentage: number
}

const readMetric = (
  lcov: string,
  coveredKey: 'LH' | 'FNH',
  totalKey: 'LF' | 'FNF'
): ICoverageMetric => {
  let covered = 0
  let total = 0

  for (const line of lcov.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex < 0) continue

    const key = line.slice(0, separatorIndex)
    const value = Number.parseInt(line.slice(separatorIndex + 1), 10)
    if (!Number.isFinite(value)) continue

    if (key === coveredKey) covered += value
    if (key === totalKey) total += value
  }

  return {
    covered,
    total,
    percentage: total > 0 ? (covered / total) * 100 : 0
  }
}

const formatMetric = (label: string, metric: ICoverageMetric, minimum: number): string => {
  return `${label}: ${metric.covered}/${metric.total} (${metric.percentage.toFixed(2)}%) · minimum ${minimum}%`
}

const run = (): number => {
  const coverageDir = mkdtempSync(join(tmpdir(), 'herdr-web-coverage-'))

  try {
    const testResult = spawnSync(
      process.execPath,
      [
        'test',
        '--coverage',
        '--coverage-reporter=lcov',
        `--coverage-dir=${coverageDir}`
      ],
      { stdio: 'inherit' }
    )

    if (testResult.error) {
      console.error(`Coverage test failed to launch: ${testResult.error.message}`)
      return 1
    }

    if (testResult.status !== 0) {
      return testResult.status ?? 1
    }

    const lcov = readFileSync(join(coverageDir, 'lcov.info'), 'utf8')
    const lines = readMetric(lcov, 'LH', 'LF')
    const functions = readMetric(lcov, 'FNH', 'FNF')

    console.log('\nGlobal coverage gate')
    console.log(formatMetric('Lines', lines, MIN_LINE_COVERAGE_PERCENT))
    console.log(formatMetric('Functions', functions, MIN_FUNCTION_COVERAGE_PERCENT))

    const failed = lines.percentage < MIN_LINE_COVERAGE_PERCENT ||
      functions.percentage < MIN_FUNCTION_COVERAGE_PERCENT

    if (failed) {
      console.error('Coverage is below the repository minimum.')
      return 1
    }

    console.log('Coverage gate passed.')
    return 0
  } finally {
    rmSync(coverageDir, { recursive: true, force: true })
  }
}

process.exitCode = run()
