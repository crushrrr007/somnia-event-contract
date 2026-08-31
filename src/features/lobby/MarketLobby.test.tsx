import { describe, expect, it } from 'vitest'
import { isCoachFollowUpReady } from './MarketLobby'

describe('scheduled coach follow-ups', () => {
  it('stays queued before expiry and becomes ready at expiry', () => {
    expect(isCoachFollowUpReady(2_000, 1_999)).toBe(false)
    expect(isCoachFollowUpReady(2_000, 2_000)).toBe(true)
    expect(isCoachFollowUpReady(2_000, 2_001)).toBe(true)
  })
})
