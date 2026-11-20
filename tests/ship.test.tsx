import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'ship-mod',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

type On = Parameters<typeof mock.clock>[0]
type World = { rollups: (string | null)[][]; notices?: unknown[][]; isGithubUp?: boolean; isGithubHung?: boolean; toasts?: string[]; noticeUrls?: string[] }

const HOUR_MS = 60 * 60 * 1000

// A state may carry an age: 'FAILURE@30' is a failure whose commit is 30 hours old.
const pr = (number: number, spec: string | null) => {
  const [state, hours] = (spec ?? '').split('@')
  return {
    number,
    title: `change ${number}`,
    url: `https://github.com/me/app/pull/${number}`,
    repository: { nameWithOwner: 'me/app' },
    commits: {
      nodes: [
        {
          commit: {
            committedDate: new Date(Date.now() - Number(hours || 0) * HOUR_MS).toISOString(),
            statusCheckRollup: spec === null ? null : { state },
          },
        },
      ],
    },
  }
}

const notice = (id: number, kind: string) => ({ id, ts: Date.now(), kind, repo: 'me/site', target: 'land/site', url: null })

// Each pull takes the next set of rollups and notices; the last set repeats.
function engine(on: On, world: World) {
  let searches = 0
  let pulls = 0
  on('command.register', () => ({ value: { command: 'ship' } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'token\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('http.fetch', (_, e) => {
    const answer = (body: unknown, ok = true) => ({ value: { status: ok ? 200 : 503, ok, headers: {}, text: JSON.stringify(body) } })
    if (e.url.includes('/notices')) {
      world.noticeUrls?.push(e.url)
      const sets = world.notices ?? [[]]
      const notices = sets[Math.min(pulls++, sets.length - 1)] ?? []
      return answer({ notices, cursor: 0 })
    }
    expect(e.url).toBe('https://api.github.com/graphql')
    expect(e.init?.headers?.authorization).toBe('Bearer token')
    if (world.isGithubHung) return new Promise<never>(() => {})
    if (world.isGithubUp === false) return answer({}, false)
    if (String(e.init?.body).includes('viewer')) return answer({ data: { viewer: { login: 'me' } } })
    const set = world.rollups[Math.min(searches++, world.rollups.length - 1)] ?? []
    return answer({ data: { mine: { nodes: set.map((state, i) => pr(i + 1, state)) }, bots: { nodes: [] } } })
  })
  on('ui.toast', (_, e) => {
    world.toasts?.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return mock.clock(on)
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('every rollup state lands in its group, and a pull request without checks is left out', async ($, on) => {
  const clock = engine(on, { rollups: [['PENDING', 'EXPECTED', 'FAILURE', 'ERROR', 'SUCCESS', null]] })
  await $.session.start(START)
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /failed/ }))?.text).toBe(
    '2 failed  app #3  app #4   2 running  app #1  app #2   1 ready',
  )
  await ui.unmount()
})

test('a failure older than 24 hours fades out, a fresh one stays', async ($, on) => {
  const clock = engine(on, { rollups: [['FAILURE@30', 'FAILURE@2', 'SUCCESS']] })
  await $.session.start(START)
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /failed/ }))?.text).toBe('1 failed  app #2   1 ready')
  await ui.unmount()
})

test('pull requests that only wait for a merge leave the band to the engine', async ($, on) => {
  const clock = engine(on, { rollups: [['SUCCESS', 'SUCCESS', null]] })
  await $.session.start(START)
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ type: 'Text', text: /SHIP/ })).toBeUndefined()
  await ui.unmount()
})

test('a result toasts once, and the first pull replays nothing', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, { rollups: [['PENDING', 'PENDING', 'FAILURE'], ['SUCCESS', 'FAILURE', 'FAILURE']], toasts })
  await $.session.start(START)
  await clock.settle()
  expect(toasts).toEqual([])

  await clock.advance(30_000)
  expect(toasts).toEqual(['ship passed: app #1', 'ship failed: app #2'])

  await clock.advance(30_000)
  expect(toasts).toEqual(['ship passed: app #1', 'ship failed: app #2'])
})

test('a deploy under way shows, and its end toasts', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, { rollups: [[]], notices: [[notice(1, 'deploy.started')], [notice(2, 'deploy.live')]], toasts })
  await $.session.start(START)
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /deploying/ }))?.text).toBe('1 deploying  site   ')
  await ui.unmount()

  await clock.advance(30_000)
  expect(toasts).toEqual(['ship live: site'])
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /SHIP/ })).toBeUndefined()
  await after.unmount()
})

test('a pull that never answers counts as failed and shows unreachable', async ($, on) => {
  const clock = engine(on, { rollups: [[]], isGithubHung: true })
  await $.session.start(START)
  await clock.advance(30_000)
  await clock.advance(30_000)
  await clock.advance(30_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /unreachable/ }))?.text).toBe('github unreachable   ')
  await ui.unmount()
})

test('a source that fails 3 pulls in a row shows as unreachable', async ($, on) => {
  const clock = engine(on, { rollups: [[]], isGithubUp: false })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(30_000)

  const early = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await early.find({ type: 'Text', text: /unreachable/ })).toBeUndefined()
  await early.unmount()

  await clock.advance(30_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /unreachable/ }))?.text).toBe('github unreachable   ')
  await ui.unmount()
})

test('/ship lists what failed first, each with its link', async ($, on) => {
  const clock = engine(on, { rollups: [['SUCCESS', 'PENDING', 'FAILURE']], notices: [[notice(1, 'deploy.started')]] })
  await $.session.start(START)
  await clock.settle()

  const ran = await $.command.run({ command: 'ship', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(ran.text).toBe(
    [
      'FAILED  app #3  change 3  https://github.com/me/app/pull/3',
      'RUNNING  app #2  change 2  https://github.com/me/app/pull/2',
      'DEPLOYING  site  land/site',
      'READY  app #1  change 1  https://github.com/me/app/pull/1',
    ].join('\n'),
  )
})

test('a pull request that comes back into the search is learned, not announced', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, { rollups: [['SUCCESS'], ['SUCCESS', 'FAILURE'], ['SUCCESS', 'SUCCESS']], toasts })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(30_000)
  expect(toasts).toEqual([])

  await clock.advance(30_000)
  expect(toasts).toEqual(['ship passed: app #2'])
})

test('/ship during the first pull shares it and replays no old deploy', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, { rollups: [[]], notices: [[notice(1, 'deploy.started'), notice(2, 'deploy.live')]], toasts })
  await $.session.start(START)
  await $.command.run({ command: 'ship', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await clock.settle()
  await clock.advance(30_000)
  expect(toasts).toEqual([])
})

test('the first notice pull asks only for the last days, later pulls use the cursor', async ($, on) => {
  const noticeUrls: string[] = []
  const clock = engine(on, { rollups: [[]], notices: [[notice(1, 'deploy.started')], []], noticeUrls })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(30_000)
  expect(noticeUrls[0]).toMatch(/[?&]since=\d{4}-\d\d-\d\dT/)
  expect(noticeUrls[1]).toContain('after=1')
  expect(noticeUrls[1]).not.toContain('since=')
})
