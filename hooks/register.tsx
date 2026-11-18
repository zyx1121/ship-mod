import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Deploy, Feed, Pr, PrState } from '../types'
import { COLOR, lineOf, panelOf, rowOf } from './panel'
import type { Seg } from './panel'

// A source that fails this many pulls in a row shows as "unreachable": a silent monitor is worse than none.
const FAILS_SHOWN = 3
// A deploy that started this long ago and never reported back is no longer under way.
const DEPLOY_MS = 15 * 60 * 1000
// A pull that has not answered by then counts as failed, so one hung request cannot stall every later pull.
const PULL_MS = 20 * 1000
// The names one group shows before it folds the rest into "+N".
const NAMES = 4
const PAGE = 500
const DAY_MS = 24 * 60 * 60 * 1000

const feed = atom({ plugin: 'ship-mod', key: 'feed' } as const, { prs: [], deploys: [], down: [] } satisfies Feed, {
  shape: 'feed-1',
})

type Notice = { id: number; ts: number; kind: string; repo: string; target: string | null; url: string | null }
type Conf = { golem: string; service: string; days: number }

// GitHub's rollup of every check on the last commit; a pull request without checks has none and is left out.
const STATE: Record<string, PrState> = { PENDING: 'running', EXPECTED: 'running', FAILURE: 'failed', ERROR: 'failed', SUCCESS: 'ready' }

// What needs the person first: the order of the panel and of /ship.
const ORDER: PrState[] = ['failed', 'running', 'ready']

const FIELDS = 'nodes { ... on PullRequest { number title url repository { nameWithOwner } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }'

// Tokens, cursors and what the last pull saw live for the session; a reload starts them over.
const link: {
  github: string | null
  login: string | null
  golem: string | null
  cursor: number | null
  latest: Map<string, Notice>
  seen: Map<string, PrState> | null
  fails: { github: number; golem: number }
  busy: Promise<void> | null
} = { github: null, login: null, golem: null, cursor: null, latest: new Map(), seen: null, fails: { github: 0, golem: 0 }, busy: null }

const short = (repo: string) => repo.split('/')[1] ?? repo
const name = (pr: Pr) => `${short(pr.repo)} #${pr.number}`

async function secret($: EngineInterface, argv: string[]): Promise<string | null> {
  try {
    const run = await $.process.run(argv, { timeoutMs: 5000 })
    const token = run.stdout.trim()
    return run.exitCode === 0 && token ? token : null
  } catch {
    return null
  }
}

async function graphql($: EngineInterface, token: string, query: string): Promise<any> {
  const res = await $.http.fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const data = res.ok ? JSON.parse(res.text).data : null
  if (!data) throw new Error('github refused the query')
  return data
}

/**
 * The open pull requests that have checks: the person's own, and the ones a
 * bot opened in the person's repositories (a release pull request).
 */
async function pullRequests($: EngineInterface, days: number): Promise<Pr[]> {
  link.github ??= await secret($, ['gh', 'auth', 'token', '--hostname', 'github.com'])
  if (link.github === null) throw new Error('gh is not signed in')
  link.login ??= (await graphql($, link.github, '{ viewer { login } }')).viewer.login as string
  const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10)
  const base = `is:pr is:open archived:false updated:>=${since}`
  const data = await graphql(
    $,
    link.github,
    `{ mine: search(query: "${base} author:${link.login}", type: ISSUE, first: 100) { ${FIELDS} } bots: search(query: "${base} user:${link.login} -author:${link.login}", type: ISSUE, first: 100) { ${FIELDS} } }`,
  )
  const prs: Pr[] = []
  for (const node of [...data.mine.nodes, ...data.bots.nodes]) {
    const state = STATE[node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? '']
    if (state) prs.push({ repo: node.repository.nameWithOwner, number: node.number, title: node.title, url: node.url, state })
  }
  return prs
}

/** The notices after the cursor, every page of them; null where golem has no token on this machine. */
async function notices($: EngineInterface, conf: Conf): Promise<Notice[] | null> {
  link.golem ??= await secret($, ['security', 'find-generic-password', '-s', conf.service, '-w'])
  if (link.golem === null) return null
  const got: Notice[] = []
  let after = link.cursor ?? 0
  // Every page, so the first pull ends at the newest notice and replays none of them later.
  for (;;) {
    const res = await $.http.fetch(`${conf.golem.replace(/\/$/, '')}/notices?after=${after}&limit=${PAGE}`, {
      headers: { authorization: `Bearer ${link.golem}` },
    })
    if (!res.ok) throw new Error('golem refused the pull')
    const body = JSON.parse(res.text) as { notices: Notice[]; cursor: number }
    got.push(...body.notices)
    // A full page whose cursor did not move would loop for ever.
    if (body.notices.length < PAGE || body.cursor <= after) break
    after = body.cursor
  }
  return got
}

/** The deploys worth a look: one under way, or one whose last word was a failure. */
function deploysOf(days: number): Deploy[] {
  const now = Date.now()
  const out: Deploy[] = []
  for (const n of link.latest.values()) {
    const age = now - n.ts
    const state = n.kind === 'deploy.started' && age < DEPLOY_MS ? 'deploying' : n.kind === 'deploy.failed' && age < days * DAY_MS ? 'failed' : null
    if (state) out.push({ repo: n.repo, target: n.target ?? '', state, url: n.url })
  }
  return out
}

/** The answer of `work`, or a rejection when it takes longer than PULL_MS. */
async function within<T>($: EngineInterface, work: Promise<T>): Promise<T> {
  const stop = new AbortController()
  const late = $.clock.sleep(PULL_MS, { signal: stop.signal }).then(() => {
    throw new Error('the pull timed out')
  })
  // Aborting the sleep rejects it once the work is done; nobody waits on that.
  late.catch(() => {})
  try {
    return await Promise.race([work, late])
  } finally {
    stop.abort()
  }
}

/** One pull at a time: the timer and /ship share the pull that is under way, so an older answer never lands on a newer one. */
function pull($: EngineInterface, conf: Conf): Promise<void> {
  return (link.busy ??= tick($, conf).finally(() => {
    link.busy = null
  }))
}

async function tick($: EngineInterface, conf: Conf) {
  const [prs, got] = await Promise.all([
    within($, pullRequests($, conf.days)).catch(() => null),
    within($, notices($, conf)).catch(() => undefined),
  ])
  link.fails.github = prs === null ? link.fails.github + 1 : 0
  link.fails.golem = got === undefined ? link.fails.golem + 1 : 0

  if (prs !== null) {
    // The first pull only learns the states, so a new session does not replay old results.
    // A pull request seen for the first time is learned too: an old one comes back into the search when someone comments.
    const isFirst = link.seen === null
    const seen = (link.seen ??= new Map())
    for (const pr of prs) {
      const was = seen.get(pr.url)
      seen.set(pr.url, pr.state)
      if (isFirst || was === undefined || was === pr.state || pr.state === 'running') continue
      $.ui.toast(`ship ${pr.state === 'failed' ? 'failed' : 'passed'}: ${name(pr)}`)
    }
  }

  if (got) {
    for (const n of got) {
      if (!n.kind.startsWith('deploy.') || n.id <= (link.cursor ?? 0)) continue
      link.latest.set(`${n.repo} ${n.target ?? ''}`, n)
      if (link.cursor === null) continue
      if (n.kind === 'deploy.live') $.ui.toast(`ship live: ${short(n.repo)}`)
      if (n.kind === 'deploy.failed') $.ui.toast(`ship deploy failed: ${short(n.repo)}`)
    }
    link.cursor = got.reduce((max, n) => Math.max(max, n.id), link.cursor ?? 0)
  }

  const down = [...(link.fails.github >= FAILS_SHOWN ? ['github'] : []), ...(link.fails.golem >= FAILS_SHOWN ? ['golem'] : [])]
  const deploys = deploysOf(conf.days)
  await update($, feed, f => ({ prs: prs ?? f.prs, deploys, down }))
}

/** One group of the line: its count, then the first names. */
function group(count: string, color: string, names: string[]): Seg[] {
  if (names.length === 0) return []
  const shown = names.slice(0, NAMES).join('  ')
  const more = names.length > NAMES ? `  +${names.length - NAMES}` : ''
  return [
    { text: `${names.length} ${count}`, color, bold: true },
    { text: `  ${shown}${more}   `, color: COLOR.text },
  ]
}

/** The panel's line, or none when nothing is running, failed or unreachable. */
function segsOf(f: Feed): Seg[] {
  const of = (state: PrState) => f.prs.filter(pr => pr.state === state)
  const deploy = (state: Deploy['state']) => f.deploys.filter(d => d.state === state).map(d => short(d.repo))
  const segs = [
    ...f.down.map(source => ({ text: `${source} unreachable   `, color: COLOR.error })),
    ...group('failed', COLOR.error, [...of('failed').map(name), ...deploy('failed').map(repo => `${repo} deploy`)]),
    ...group('running', COLOR.warn, of('running').map(name)),
    ...group('deploying', COLOR.warn, deploy('deploying')),
  ]
  if (segs.length === 0) return []
  const ready = of('ready').length
  return ready > 0 ? [...segs, { text: `${ready} ready`, color: COLOR.label }] : segs
}

export const register: Register = (on, options) => {
  const conf: Conf = {
    golem: String(options.golemUrl || 'https://golem.zyx.tw'),
    service: String(options.keychainService || 'kilo/golem-mcp'),
    days: Math.max(1, Number(options.days) || 2),
  }
  const seconds = Math.max(10, Number(options.pollSeconds) || 30)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ship', description: 'List the pull requests and deploys under way' })
    void pull($, conf)
    $.clock.every(seconds * 1000, () => pull($, conf))
    return next(e)
  })

  on('command.run', { command: 'ship' }, async $ => {
    await pull($, conf)
    const f = await read($, feed)
    const lines = [
      ...f.down.map(source => `${source} is unreachable.`),
      ...ORDER.flatMap(state => [
        ...f.prs.filter(pr => pr.state === state).map(pr => `${state.toUpperCase()}  ${name(pr)}  ${pr.title}  ${pr.url}`),
        ...f.deploys.filter(d => d.state === (state === 'running' ? 'deploying' : state)).map(d => `${d.state.toUpperCase()}  ${short(d.repo)}  ${d.target}${d.url ? `  ${d.url}` : ''}`),
      ]),
    ]
    // For the person only: a pull request title is text a stranger can write, so it stays out of the model's context.
    return { text: lines.length === 0 ? 'Nothing under way.' : lines.join('\n'), isTextDisplayOnly: true }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, feed)
    const segs = segsOf(f)
    if (e.props.hasSurvey || segs.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const kit = { Box, Text }
    const tone = f.down.length > 0 ? 'error' : 'normal'
    // The whole band width, and free to shrink: alone the panel fills its row, beside GOLEM the two shrink to a half each.
    const panel = panelOf(kit, { title: 'SHIP', tone, width: e.props.bodyColumns }, lineOf(kit, segs))
    return rowOf(kit, [panel], await next(e))
  })

  // The engine stacks one row for each mod. When golem-mod drew one too, the two share a row, half each.
  // A Box that holds another mod's row takes no width, so each panel asks for the whole band and the row shrinks them alike.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const rows = e.props.rows
    const golem = rows.find(row => row.plugin === 'golem-mod')
    const ship = rows.find(row => row.plugin === 'ship-mod')
    if (!golem || !ship) return next(e)
    const { Box } = $.ui.resolve(e)
    const only = (kept: typeof rows) => next({ ...e, props: { ...e.props, rows: kept } })
    return (
      <Box flexDirection="column">
        {await only(rows.filter(row => row !== golem && row !== ship))}
        <Box flexDirection="row">
          <Box flexShrink={1}>{await only([golem])}</Box>
          <Box flexShrink={1}>{await only([ship])}</Box>
        </Box>
      </Box>
    )
  })
}
