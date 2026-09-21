import { describe, expect, it } from 'bun:test'
import {
  calculateDistanceFromBottom,
  calculateNewScrollTop,
  isNearBottom
} from '../scroll-position.ts'

describe('scroll-position: isNearBottom', () => {
  it('returns true when content completely fits in client viewport', () => {
    expect(isNearBottom(0, 300, 400)).toBe(true)
  })

  it('returns true when scroll is within threshold of bottom', () => {
    // scrollHeight: 1000, clientHeight: 400, maxScroll: 600
    // at scrollTop = 580, distanceFromBottom = 20 <= 48
    expect(isNearBottom(580, 1000, 400, 48)).toBe(true)
    // at scrollTop = 600, distanceFromBottom = 0
    expect(isNearBottom(600, 1000, 400, 48)).toBe(true)
  })

  it('returns false when scrolled upward beyond threshold', () => {
    // distanceFromBottom = 1000 - 500 - 400 = 100 > 48
    expect(isNearBottom(500, 1000, 400, 48)).toBe(false)
  })
})

describe('scroll-position: calculateDistanceFromBottom', () => {
  it('calculates exact positive distance from bottom', () => {
    expect(calculateDistanceFromBottom(200, 1000, 400)).toBe(400)
  })

  it('clamps to zero when scrolled past bottom or content fits', () => {
    expect(calculateDistanceFromBottom(700, 1000, 400)).toBe(0)
    expect(calculateDistanceFromBottom(0, 200, 500)).toBe(0)
  })
})

describe('scroll-position: calculateNewScrollTop', () => {
  it('snaps to bottom when followLatest is true', () => {
    const result = calculateNewScrollTop({
      followLatest: true,
      prevScrollTop: 200,
      prevScrollHeight: 1000,
      newScrollHeight: 1200,
      clientHeight: 400
    })
    // new maxScroll = 1200 - 400 = 800
    expect(result).toBe(800)
  })

  it('preserves reading position using distance-from-bottom when followLatest is false', () => {
    // User was 250px away from bottom in previous scroll
    // In new content (scrollHeight: 1500, clientHeight: 400),
    // target scrollTop = 1500 - 400 - 250 = 850
    const result = calculateNewScrollTop({
      followLatest: false,
      prevScrollTop: 350,
      prevScrollHeight: 1000,
      newScrollHeight: 1500,
      clientHeight: 400,
      prevDistanceFromBottom: 250
    })
    expect(result).toBe(850)
  })

  it('preserves previous scrollTop when prevDistanceFromBottom is not provided', () => {
    const result = calculateNewScrollTop({
      followLatest: false,
      prevScrollTop: 300,
      prevScrollHeight: 1000,
      newScrollHeight: 1500,
      clientHeight: 400
    })
    expect(result).toBe(300)
  })

  it('clamps preserved scrollTop to maxScroll if content shrunk', () => {
    const result = calculateNewScrollTop({
      followLatest: false,
      prevScrollTop: 600,
      prevScrollHeight: 1000,
      newScrollHeight: 700,
      clientHeight: 400
    })
    // new maxScroll = 700 - 400 = 300
    expect(result).toBe(300)
  })
})
