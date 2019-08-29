import { SpringInterpolator } from 'shared'
import { deprecateInterpolate } from 'shared/deprecations'
import { AnimatedInterpolation } from './AnimatedInterpolation'

export const to: SpringInterpolator = (source: any, ...args: any) =>
  new AnimatedInterpolation(source, args)

export const interpolate: SpringInterpolator = (...args: [any, any]) => {
  deprecateInterpolate()
  return to(...args)
}
