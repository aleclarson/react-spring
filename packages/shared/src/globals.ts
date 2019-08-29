import { InterpolatorConfig } from './types'

declare const window: {
  requestAnimationFrame: (cb: (time: number) => void) => number
  cancelAnimationFrame: (id: number) => void
}

//
// Required
//

/** Provide custom logic for string interpolation */
export let createStringInterpolator: (
  config: InterpolatorConfig<string>
) => (input: number) => string

/** Provide a custom `FrameLoop` instance */
export let frameLoop: {
  update: () => boolean
  controllers: Map<number, any>
  start(controller: any): void
  stop(controller: any): void
}

//
// Optional
//

export let now = () => Date.now()

/** Make all animations instant and skip the frameloop entirely */
export let skipAnimation = false

export let requestAnimationFrame: typeof window.requestAnimationFrame =
  typeof window !== 'undefined' ? window.requestAnimationFrame : () => -1

export let cancelAnimationFrame: typeof window.cancelAnimationFrame =
  typeof window !== 'undefined' ? window.cancelAnimationFrame : () => {}

//
// Configuration
//

export interface AnimatedGlobals {
  now?: typeof now
  frameLoop?: typeof frameLoop
  skipAnimation?: typeof skipAnimation
  createStringInterpolator?: typeof createStringInterpolator
  requestAnimationFrame?: typeof requestAnimationFrame
  cancelAnimationFrame?: typeof cancelAnimationFrame
}

export const assign = (globals: AnimatedGlobals): AnimatedGlobals =>
  ({
    now,
    frameLoop,
    skipAnimation,
    createStringInterpolator,
    requestAnimationFrame,
    cancelAnimationFrame,
  } = Object.assign(
    {
      now,
      frameLoop,
      skipAnimation,
      createStringInterpolator,
      requestAnimationFrame,
      cancelAnimationFrame,
    },
    pluckDefined(globals)
  ))

// Ignore undefined values
function pluckDefined(globals: any) {
  const defined: any = {}
  for (const key in globals) {
    if (globals[key] !== void 0) defined[key] = globals[key]
  }
  return defined
}
