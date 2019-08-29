import { is, toArray, each } from 'shared'
import * as G from 'shared/globals'
import {
  Animatable,
  Animation,
  AnimationList,
  AnimationMap,
  AnimationProps,
  AnimatedNodes,
  SpringAsyncFn,
  SpringConfig,
  SpringUpdate,
  ToProp,
} from './types/spring'
import { StringKeys, Indexable, OnEnd, Falsy, Merge } from './types/common'
import { callProp, interpolateTo, withDefault, freeze } from './helpers'
import {
  Animated,
  AnimatedArray,
  AnimatedInterpolation,
  AnimatedValue,
} from '@react-spring/animated'
import { Spring } from './Spring'

/**
 * A tuple containing:
 *
 *   [0] `controllerID`: The controller being updated
 *
 *   [1] `idle`: True when all animations have finished
 *
 *   [2] `changes`: An array of `[key, value]` tuples
 */
export type FrameUpdate<State extends object = any> = [
  number,
  boolean,
  [keyof State, State[keyof State]][] | null
]

type UpdateProps<State extends object> = Merge<
  AnimationProps<State>,
  {
    to?: ToProp<State>
    from?: Partial<State>
    timestamp?: number
  }
>

// Default easing
const linear = (t: number) => t

const emptyObj: any = Object.freeze({})

let nextId = 1
export class Controller<State extends Indexable = any> {
  id = nextId++
  idle = true
  runCount = 0
  springs = {} as Indexable<Spring>
  asyncTo?: ReadonlyArray<SpringUpdate<State>> | SpringAsyncFn<State>
  onEndQueue: OnEnd[] = []
  cancelledAt = 0
  destroyed = false

  constructor(props?: Partial<State> & UpdateProps<State>) {
    if (props) this.update(props).start()
  }

  /**
   * Push props into the update queue. The props are used after `start` is
   * called and any delay is over. The props are intelligently diffed to ensure
   * that later calls to this method properly override any delayed props.
   * The `propsArg` argument is always copied before mutations are made.
   */
  update(propsArg: (Partial<State> & UpdateProps<State>) | Falsy) {
    if (!propsArg || this.destroyed) return this
    const props: UpdateProps<State> = interpolateTo(propsArg)
    const keys = new Set<string>()

    const { from, to } = props
    if (is.arr(to) || is.fun(to)) {
      // TODO: update "this.asyncTo" but respect "props.delay"
    } else if (is.obj(to)) {
      each(Object.keys(to), key => keys.add(key))
    } else {
      props.to = void 0
    }

    if (is.obj(from)) {
      each(Object.keys(from), key => keys.add(key))
    } else {
      props.from = void 0
    }

    props.timestamp = G.now()
    each(keys, key => {
      const spring = this.springs[key] || (this.springs[key] = new Spring(key))
      spring.push(props as any)
    })

    return this
  }

  /**
   * Flush the update queue, and call `onEnd` when they have settled.
   *
   * The `onEnd` callback does **not** wait for unsettled updates from previous `start` calls.
   */
  start(onEnd?: OnEnd) {
    each(this.springs, spring => spring.flush(onEnd))
    // if (this.queue.length) this._flush(onEnd)
    // else if (onEnd) onEnd()
    return this
  }

  /** Stop one animation or all animations */
  stop(...keys: StringKeys<State>[]) {
    // Stop animations by key
    if (keys.length) {
      for (const key of keys) {
        const index = this.configs.findIndex(config => key === config.key)
        this._stopAnimation(key)
        this.configs[index] = this.animations[key]
      }
    }
    // Stop all animations
    else if (this.runCount) {
      this.cancelledAt = G.now()

      // Update the animation configs
      each(this.configs, config => this._stopAnimation(config.key))
      this.configs = Object.values(this.animations) as any

      // Exit the frameloop
      if (!this.idle) {
        this._stop()
      }
    }
    return this
  }

  /** Revert the controller to its initial state */
  reset() {
    // Stop all current animations
    this.stop()

    // Revert the internal state
    this.animated = {} as any
    this.animations = {} as any
    this.configs = []

    return this
  }

  /** Prevent all current and future animation */
  destroy() {
    if (!this.destroyed) {
      this.stop()
      this.destroyed = true
    }
  }

  /** @internal Called by the frameloop */
  onFrame([id, idle, changes]: FrameUpdate<State>) {
    if (id !== this.id) return
    if (changes && changes.length) {
      for (const [key, value] of changes) {
        this.springs[key] = value
      }
      // The `onFrame` prop always exists when `changes` exists.
      this.props.onFrame!({
        ...this.springs,
      })
    }
    if (idle) {
      this._stop()
    }
  }

  // Add this controller to the frameloop.
  private _start(onEnd?: OnEnd) {
    if (this.idle) {
      if (this.configs.some(config => !config.idle)) {
        this.idle = false
        G.frameLoop.start(this)
      } else if (onEnd) {
        return onEnd()
      }
    }
    if (onEnd) {
      this.onEndQueue.push(onEnd)
    }
  }

  // Remove this controller from the frameloop, and notify any listeners.
  private _stop() {
    this.idle = true
    G.frameLoop.stop(this)

    const { onRest } = this.props
    if (is.fun(onRest)) {
      onRest(this.merged)
    }

    const { onEndQueue } = this
    if (onEndQueue.length) {
      this.onEndQueue = []
      each(onEndQueue, onEnd => onEnd())
    }
  }

  // Start an async chain or an async script.
  private _runAsync({ to, ...props }: PendingProps<State>, onEnd: OnEnd) {
    // Merge other props immediately.
    if (this._diff(props)) {
      this._animate(props)
    }

    // Async scripts can be declaratively cancelled.
    if (props.cancel === true) {
      this.props.asyncTo = void 0
      return onEnd()
    }

    // Never run more than one script at a time
    const { timestamp } = props
    if (!this._diff({ asyncTo: to, timestamp })) {
      return onEnd()
    }

    const isCancelled = () =>
      // Cancelling methods touch the `cancelledAt` property
      timestamp! < this.cancelledAt ||
      // Async scripts are also cancelled when a new chain/script begins
      (is.fun(to) && to !== this.props.asyncTo)

    let last: Promise<void>
    const next = (props: Partial<State> & PendingProps<State>) => {
      if (isCancelled()) throw this
      return (last = new Promise<any>(done => {
        this.update(props).start(done)
      })).then(() => {
        if (isCancelled()) throw this
      })
    }

    let queue = Promise.resolve()
    if (is.arr(to)) {
      each(to, props => {
        queue = queue.then(() => next(props))
      })
    } else if (is.fun(to)) {
      queue = queue.then(() =>
        to(next, this.stop.bind(this))
          // Always wait for the last update.
          .then(() => last)
      )
    }

    queue.catch(err => err !== this && console.error(err)).then(onEnd)
  }
}

/** Wrap any value with an `Animated` node */
function createAnimated<T>(
  value: T
): T extends ReadonlyArray<any>
  ? AnimatedArray
  : AnimatedValue | AnimatedInterpolation {
  return is.arr(value)
    ? new AnimatedArray(value.map(createAnimated))
    : isAnimatableString(value)
    ? // Convert "red" into "rgba(255, 0, 0, 1)" etc
      (new AnimatedValue(0).to({
        output: [value, value] as any,
      }) as any)
    : // The `AnimatedValue` class supports any type, but only numbers are
      // interpolated by the frameloop.
      new AnimatedValue(value)
}

/**
 * Replace an `Animated` node in the graph.
 * This is most useful for async updates, which don't cause a re-render.
 */
function moveChildren(prev: Animated, next: Animated) {
  each(Array.from(prev.getChildren()), child => {
    child.updatePayload(prev, next)
    prev.removeChild(child)
    next.addChild(child)
  })
}

// Merge updates with the same delay.
// NOTE: Mutation of `props` may occur!
function reduceDelays(merged: any[], props: any) {
  const prev = merged[props.delay]
  if (prev) {
    props.to = merge(prev.to, props.to)
    props.from = merge(prev.from, props.from)
    Object.assign(prev, props)
  } else {
    merged[props.delay] = props
  }
  return merged
}

function merge(dest: any, src: any) {
  return is.obj(dest) && is.obj(src) ? { ...dest, ...src } : src || dest
}

// Not all strings can be animated (eg: {display: "none"})
function isAnimatableString(value: unknown): boolean {
  if (!is.str(value)) return false
  return (
    value.startsWith('#') ||
    /\d/.test(value) ||
    !!(G.colorNames && G.colorNames[value])
  )
}

// Compute the goal value, converting "red" to "rgba(255, 0, 0, 1)" in the process
function computeGoalValue<T>(value: T): T {
  return is.arr(value)
    ? value.map(computeGoalValue)
    : isAnimatableString(value)
    ? (G.createStringInterpolator as any)({
        range: [0, 1],
        output: [value, value],
      })(1)
    : value
}

// Compare animatable values
function isEqual(a: Animatable, b: Animatable) {
  if (is.arr(a)) {
    if (!is.arr(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
  return a === b
}
