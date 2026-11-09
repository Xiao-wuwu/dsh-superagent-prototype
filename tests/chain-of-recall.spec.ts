// Chain of recall (article §3.3): every recalled object must inline the identifier and read path of the next hop,
// so a Session can walk Trigger → Thread → Ticket → Worker Session → another Thread without a full-history prompt.
import { expect, it } from 'vitest'
import { decisionCard, threadCard, ticketDetails, triggerCard } from '../src/app/cards.ts'
import type { Decision, Thread, Ticket, Trigger } from '../src/core/index.ts'

const trigger = {
  id: 'tr1', source: 'github', threads: [{ source: 'github', id: '7' }], actor: { source: 'github', id: 'alice' },
  human: true, at: '2026-11-01T00:00:00.000Z', text: 'please add a section',
  url: 'https://github.com/acme/widgets/issues/7', meta: {},
} as unknown as Trigger

const thread = {
  key: 'github:7', ref: { source: 'github', id: '7' }, createdAt: '2026-11-01T00:00:00.000Z',
  subscriptions: ['t9'], correlated: [], pending: [], meta: {},
} as unknown as Thread

const ticket: Ticket = {
  id: 't9', title: 'Add a section', decisionId: 'd-t9',
  mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' }, actor: { source: 'github', id: 'alice' }, scope: '' },
  channels: [{ source: 'github', thread: 'github:7', address: { number: '7' } }],
  assignments: [], inputs: [], undelivered: [], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  origin: { triggerId: 'tr1', triggerIds: ['tr1'] },
} as unknown as Ticket

const decision = {
  id: 'd1', threadKey: 'github:7', triggerIds: ['tr1'], ticketId: 't9',
  kind: 'accept', reason: [], strength: 'explicit', at: '2026-11-01T00:00:00.000Z',
} as unknown as Decision

it('walks Trigger → Thread → Ticket → Worker Session without needing a full history prompt', () => {
  // A Trigger names its Thread and how to read itself again.
  const triggerView = triggerCard(trigger)
  expect(triggerView).toMatchObject({ trigger_id: 'tr1', thread: 'github:7', read: 'trigger/tr1' })

  // The Thread names the Tickets following it, and the path back to itself.
  const threadView = threadCard(thread, 'widgets#7')
  expect(threadView).toMatchObject({ thread: 'github:7', tickets: ['t9'], read: 'thread/github:7' })

  // The Ticket names its Trigger, its Decision, its Threads, and the paths into its Worker Session.
  const ticketView = ticketDetails(ticket, [{ thread: 'github:7' }], [])
  expect(ticketView).toMatchObject({
    trigger_id: 'tr1',
    decision_id: 'd-t9',
    threads: [{ thread: 'github:7' }],
    transcript: 'ticket/t9/transcript',
    assignment: 'ticket/t9/assignment',
    result: 'ticket/t9/result',
  })

  // The Decision links back to its Thread, its Triggers and its Ticket.
  expect(decisionCard(decision)).toMatchObject({
    decision_id: 'd1', thread: 'github:7', trigger_ids: ['tr1'], ticket_id: 't9', read: 'decision/d1',
  })
})

it('keeps the hop a card offers the same identifier the next resource is read by', () => {
  // The invariant that makes the chain walkable: a card's `read` path addresses exactly the object it named.
  const views = [triggerCard(trigger), threadCard(thread, 'widgets#7'), decisionCard(decision)] as Record<string, unknown>[]
  for (const view of views) {
    const read = String(view.read)
    expect(read.includes('/')).toBe(true)
    const named = read.includes('thread/') ? view.thread : read.includes('decision/') ? view.decision_id : view.trigger_id
    expect(read.split('/').at(-1)).toBe(String(named))
  }
})
