import { Indexable, Arrify, Merge } from './types/common'
import { SpringConfig, Animatable, AnimationProps } from './types/spring'
import { is, each } from 'shared'
import { callProp } from './helpers'
import { AnimatedValue } from '@react-spring/animated'
import invariant from 'tiny-invariant'
import * as G from 'shared/globals'

/** These properties exist in every animation config. */
// interface AnimationConfig<T = unknown> {
//   goalValue: T
//   animatedValues: AnimatedValue[]
//   // Note: This type is not 100% accurate, but it makes TypeScript happy.
//   animated: Animated &
//     Spring<T> & {
//       /**
//        * Set the animated value. The `flush` argument is true by default.
//        */
//       setValue?: (newValue: T, flush?: boolean) => void
//     }
// }

/** An animation being executed by the frameloop */
export interface Animation<T = any> {
  done: boolean
  spring: Spring<T>
  values: AnimatedValue[]
  to: T | Spring<T>
  toValues: Arrify<T>
  from: T
  fromValues: Arrify<T>
  config: SpringConfig & { w0?: number }
  immediate: boolean
  promise: Promise<AnimationResult<T>>
  onStart: (key: string, animation: Animation<T>) => void
  onFrame: (key: string, value: T) => void
  onRest: Array<(key: string, result: AnimationResult<T>) => void>
}

/** Animation props not yet used */
export type PendingProps = Merge<
  AnimationProps,
  {
    to?: Indexable
    from?: Indexable
    timestamp?: number
  }
>

type CachedProps = {}

let nextId = 1

/** The spring was disposed of */
const DELETED = 0
/** The spring has not animated yet */
const CREATED = 1
/** The spring is animating */
const BUSY = 2
/** The spring stopped animating */
const IDLE = 3

type OnChange<T> = (value: T) => void
type AnimationResult<T> = { finished: boolean; value: T }
type OnRest<T> = (result: AnimationResult<T>) => void

const noop = () => {}

/** An opaque animatable value */
export class Spring<T = any> {
  readonly id = nextId++
  /** The active animation */
  animation?: Animation<T>
  /** The default props */
  defaultProps: CachedProps
  /** The lifecycle phase of this spring */
  private _phase = CREATED
  /** The last time each prop changed */
  private _timestamps: Indexable<number> = {}
  /** Cancel any update from before this timestamp */
  private _cancelledAt = 0
  /** The props changed by the current diff */
  private _changed!: Set<string>
  /** The animated props of components using this spring */
  private _children: (OnChange<T> | Spring<T>)[] = []
  /** The queue of pending props */
  private _queue: PendingProps[] = []
  /** The animated node that may be a number, array, or interpolation */
  private _node!: Animated

  constructor(readonly key: string, defaults?: CachedProps) {
    this.defaultProps = defaults ? Object.setPrototypeOf({}, defaults) : {}
  }

  get() {
    return this._node.getValue()
  }

  set(value: T, flush = true) {
    this._node.setValue(value, flush)
  }

  _diff(prop: string, timestamp: number) {
    if (timestamp >= this._timestamps[prop] || 0) {
      this._timestamps[prop] = timestamp
      return true
    }
    return false
  }

  /**
   * Stop the animation on its next frame, and prevent updates from before the
   * `timestamp` argument.
   */
  stop(timestamp = G.now()) {
    invariant(this._phase > DELETED)
    this._cancelledAt = timestamp
    const anim = this.animation
    if (anim) {
      anim.to = this.get()
      this._onAnimationEnd(anim)
    }
    return this
  }

  _onAnimationEnd(anim: Animation<T>, finished = false) {
    this._phase = IDLE

    anim.done = true
    each(anim.values, node => {
      node.done = true
    })

    const onRestQueue = [...anim.onRest]
    anim.onRest.length = 1

    const result = { value: this.get(), finished }
    each(onRestQueue, onRest => onRest(this.key, result))
  }

  _update(props: PendingProps, timestamp: number, onRest: OnRest<T>) {
    // Might be cancelled before start.
    if (timestamp < this._cancelledAt) {
      return
    }

    // Must be a boolean.
    if (props.cancel) {
      this.stop(timestamp)
      return
    }

    const diff = (prop: string) => prop in props && this._diff(prop, timestamp)
    const anim: Partial<Animation<T>> = this.animation || {}
    const value = this.get()

    // Might be undefined.
    let to = props.to && props.to[this.key]
    if (is.und(to) || !diff('to')) {
      to = anim.to
    }

    // When undefined, use the current value.
    let from = props.from && props.from[this.key]
    if (is.und(from) || !diff('from')) {
      from = anim.from
      if (is.und(from)) {
        from = value
      }
    }

    if (props.reverse) {
      ;[to, from] = [from, to]
    }

    // TODO: merge "config" here

    if (!is.und(to)) {
      const goal = computeGoal(to)
      if (!this.animation || !isEqual(goal, anim.to)) {
        // TODO
      }
    }

    const onRestQueue = anim.onRest || (anim.onRest = [noop])
    onRestQueue.push((_, result) => onRest(result))

    // The "onRest" prop is always first.
    const onRestProp = diff('onRest') && props.onRest
    if (onRestProp || onRestProp === null) {
      onRestQueue[0] = onRestProp || noop
    }

    if (props.reset) {
    }
    if (props.cancel) {
    }
  }

  /** Update this value's animation using the given props. */
  update(props: PendingProps) {
    return new Promise(resolve => {
      const timestamp = G.now()
      const delay = callProp(props.delay, this.key)
      if (delay && delay > 0)
        setTimeout(() => this._update(props, resolve), delay)
      else this._update(props, resolve)
    })

    let { from } = props
    if (from) from = from[this.key]
    if (is.und(from)) {
      from = this.props.from // TODO: treat "props.to" as "props.from" on first update if "props.from" is undefined
    }
    // TODO: convert some props from function to value: "config", "immediate", "delay"
    //   Math.max(0, Math.round(props.delay(key)))
  }

  /** Push props into the pending queue. */
  push(props: PendingProps) {
    const from = props.from && props.from[this.key]
    if (this.isNew && !is.und(from)) {
      // TODO: set initial value
      //    animated.setValue(computeGoalValue(value))
    }
    // // The `delay` prop of every update must be a number >= 0
    // if (is.fun(props.delay) && is.obj(props.to)) {
    //   const from = props.from || emptyObj
    //   for (const key in props.to) {
    //     this.queue.push({
    //       ...props,
    //       to: { [key]: props.to[key] },
    //       from: key in from ? { [key]: from[key] } : void 0,
    //       delay: ,
    //     })
    //   }
    // } else {
    //   props.delay = is.num(props.delay)
    //     ? Math.max(0, Math.round(props.delay))
    //     : 0
    //   this.queue.push(props)
    // }
  }

  /** Update this value's animation using the queue of pending props. */
  start(): Promise<void> {}

  onChange(fn: (value: any) => void): () => void {
    const kids = this._children
    kids.push(fn)
    return () => {
      const i = kids.indexOf(fn)
      if (~i) kids.splice(i, 1)
    }
  }

  // key,
  // idle: false,
  // goalValue,
  // toValues,
  // fromValues,
  // animated,
  // animatedValues: Array.from(animated.getPayload()),
  // immediate,
  // duration: config.duration,
  // easing: withDefault(config.easing, linear),
  // decay: config.decay,
  // mass: withDefault(config.mass, 1),
  // tension: withDefault(config.tension, 170),
  // friction: withDefault(config.friction, 26),
  // initialVelocity: withDefault(config.velocity, 0),
  // clamp: withDefault(config.clamp, false),
  // precision: withDefault(config.precision, 0.005),
  // config,

  // Execute the current queue of prop updates.
  private _flush(onEnd?: OnEnd) {
    const queue = this.queue.reduce(reduceDelays, [])
    this.queue.length = 0

    // Track the number of unsettled updates.
    let runsLeft = Object.keys(queue).length
    this.runCount += runsLeft

    // Any run can finish last.
    const onRunEnd = () => {
      this.runCount--
      if (!--runsLeft && onEnd) {
        onEnd()
      }
    }

    each(queue, (props, delay) => {
      if (delay) {
        setTimeout(() => {
          // Cancelling methods touch the `cancelledAt` property
          if (props.timestamp < this.cancelledAt) return
          this._run(props, onRunEnd)
        }, delay)
      } else {
        this._run(props, onRunEnd)
      }
    })
  }
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
function computeGoal<T>(value: T): T {
  return is.arr(value)
    ? value.map(computeGoal)
    : isAnimatableString(value)
    ? (G.createStringInterpolator as any)({
        range: [0, 1],
        output: [value, value],
      })(1)
    : value
}

// Compare animatable values
function isEqual(a: any, b: any) {
  if (is.arr(a)) {
    if (!is.arr(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
  return a === b
}
