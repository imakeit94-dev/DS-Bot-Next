// The 0.3.1 probe predates explicit onboarding and cannot safely exercise 0.3.2.
// The frozen 0.3.1 worktree retains the independently reviewed historical runner.
import { pathToFileURL } from 'node:url'

export async function probe() {
  throw new Error('The 0.3.1 product probe is unavailable for 0.3.2 onboarding')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = 2
}
