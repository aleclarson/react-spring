import { Indexable, Arrify, Merge } from './types/common'
import { SpringConfig, Animatable, AnimationProps } from './types/spring'
import { is, each, EasingFunction, toArray } from 'shared'
import { callProp } from './helpers'
import {
  AnimatedValue,
  AnimatedString,
  AnimatedArray,
} from '@react-spring/animated'
import invariant from 'tiny-invariant'
import * as G from 'shared/globals'
import { config } from './constants'

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

type OnStart<T> = (spring: Spring<T>) => void
type OnChange<T> = (value: T, spring?: Spring<T>) => void
type OnRest<T> = (result: AnimationResult<T>, spring?: Spring<T>) => void
type AnimationResult<T> = { finished: boolean; value: T }

/** An animation being executed by the frameloop */
export interface Animation<T = any> {
  done: boolean
  values: AnimatedValue[]
  to: T | Spring<T>
  toValues: number[] | null
  from: T
  fromValues: number[]
  config?: {
    mass: number
    tension: number
    friction: number
    velocity: number
    precision: number
    w0: number
    easing: EasingFunction
    duration?: number
    clamp?: boolean
    decay?: number | boolean
  }
  reverse?: boolean
  immediate: boolean
  promise?: Promise<AnimationResult<T>>
  onChange?: Array<OnChange<T>>
  onRest: Array<OnRest<T>>
  owner: Spring<T>
}

/** Animation props not yet used */
export type PendingProps<T = any> = Merge<
  AnimationProps,
  {
    to?: Animatable<T> | Spring<T> | Indexable
    from?: Animatable<T> | Spring<T> | Indexable
    cancel?: boolean
    onStart?: OnStart<T>
    onChange?: OnChange<T>
    onRest?: OnRest<T> | null
  }
>

let nextId = 1

/** The spring was disposed of */
const DELETED = 0
/** The spring has not animated yet */
const CREATED = 1
/** The spring is animating */
const BUSY = 2
/** The spring stopped animating */
const IDLE = 3

const noop = () => {}

const defaultConfig: SpringConfig = {
  ...config.default,
  velocity: 0,
  precision: 0.005,
  easing: t => t,
}

/** An opaque animatable value */
export class Spring<T = any> {
  readonly id = nextId++
  /** The animation state */
  animation?: Animation<T>
  /** The default props */
  defaultProps: PendingProps
  /** The lifecycle phase of this spring */
  private _phase = CREATED
  /** The last time each prop changed */
  private _timestamps: Indexable<number> = {}
  /** Cancel any update from before this timestamp */
  private _cancelledAt = 0
  /** The animated props of components using this spring */
  private _children: (OnChange<T> | Spring<T>)[] = []
  /** The queue of pending props */
  private _queue: PendingProps[] = []
  /** The animated node */
  protected _node!: AnimatedValue | AnimatedArray | AnimatedString

  constructor(readonly key: string, defaults?: PendingProps) {
    this.defaultProps = defaults ? Object.setPrototypeOf({}, defaults) : {}
  }

  get() {
    return this._node.getValue() as T
  }

  set(value: T, flush = true) {
    this._node.setValue(value)
    if (flush) {
      // TODO: notify AnimatedProps and onChange queue
    }
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

  finish() {} // TODO

  _onAnimationEnd(anim: Animation<T>, finished = false) {
    this._phase = IDLE

    anim.done = true
    each(anim.values, node => {
      node.done = true
    })

    const onRestQueue = anim.onRest
    anim.onRest = []

    const result = { value: this.get(), finished }
    each(onRestQueue, onRest => onRest(result, this))
  }

  _update(props: PendingProps<T>, timestamp: number, onRest: OnRest<T>) {
    // Might be cancelled before start.
    if (timestamp < this._cancelledAt) {
      return
    }

    // TODO: should this logic be moved to Controller?
    if (props.cancel) {
      this.stop(timestamp)
      return
    }

    const diff = (prop: string) => this._diff(prop, timestamp)
    const anim: Partial<Animation<T>> = this.animation || {
      done: true,
      owner: this,
    }

    // The "reverse" prop is applied by the FrameLoop.
    if (!is.und(props.reverse)) {
      anim.reverse = props.reverse
    }

    const { key } = this

    // The "to" and "from" props can be an animatable value, another
    // Spring instance, or a to/from object from a Controller update.
    let { to, from } = props as any

    // Write or read the "to" prop
    to = !is.obj(to) || to instanceof Spring ? to : to[key]
    if (!is.und(to) && diff('to')) {
      anim.to = to
    } else {
      to = anim.to
    }

    // Write or read the "from" prop
    from = !is.obj(from) || from instanceof Spring ? from : from[key]
    if (!is.und(from) && diff('from')) {
      anim.from = from
    } else if (props.reset) {
      from = anim.from
    }

    // Use the current value when "from" is undefined.
    if (is.und(from)) {
      from = this.get()
    }
    // Start from the current value of another Spring.
    else if (from instanceof Spring) {
      from = from.get()
    }

    // Ensure "to" is not undefined.
    if (is.und(to)) {
      to = from
    }

    const changed = props.force || !isEqual(to, anim.to)

    // The "config" prop is ignored for delayed updates except
    // for when they change the goal value.
    if (props.config && (diff('config') || changed)) {
      let config = callProp(props.config, key) as CachedSpringConfig
      if (config) {
        config = { ...defaultConfig, ...config }

        // Cache the angular frequency in rad/ms
        config.w0 = Math.sqrt(config.tension / config.mass) / 1000

        if (
          anim.config &&
          is.und(config.decay) == is.und(anim.config.decay) &&
          is.und(config.duration) == is.und(anim.config.duration)
        ) {
          Object.assign(anim.config, config)
        } else {
          anim.config = config
        }
      }
    }

    const parent = to instanceof Spring ? to : null
    let goal: any = parent ? null : computeGoal<T>(to)

    // Update our internal Animated node.
    let node = this._node
    let nodeType: any
    if (!node || changed) {
      const parentType = parent && parent._node.constructor
      nodeType =
        parentType == AnimatedString
          ? AnimatedValue
          : parentType ||
            (is.arr(goal)
              ? AnimatedArray
              : needsInterpolation(goal)
              ? AnimatedString
              : AnimatedValue)

      // Create a new Animated node if necessary.
      if (!node || !(node instanceof nodeType)) {
        // TODO: implement "create" static methods
        this._node = node = nodeType.create(computeGoal(from), goal)
        anim.values = Array.from(node.getPayload())
      } else {
        node.reset(!anim.done)
      }
    }

    if (nodeType == AnimatedString) {
      from = 0
      goal = 1
    }

    if (changed) {
      anim.toValues = parent ? null : toArray(goal)
    }

    if (props.reset) {
      anim.fromValues = toArray(from)
    } else if (changed) {
      anim.fromValues = Array.from(node.getPayload(), node =>
        node.getValue()
      ) as any
    }

    if (props.reset || changed) {
      anim.immediate = !!callProp(props.immediate, key)
    }

    // Event props are provided per update.
    if (changed) {
      const changeQueue = anim.onChange || []
      if (props.onChange) {
        changeQueue.push(props.onChange)
        anim.onChange = changeQueue
      }

      // The "onRest" prop is always first in the queue.
      const restQueue: OnRest<T>[] = (anim.onRest = [])
      restQueue[0] = props.onRest || noop
      restQueue.push(onRest)

      if (props.onStart && !anim.immediate) {
        props.onStart(this)
      }
    }

    // Cast from a partial type.
    this.animation = anim as Animation<T>

    if (G.skipAnimation) {
      this.set(parent ? parent.get() : to)
      return this._onAnimationEnd(this.animation!, true)
    }

    if (anim.done && (props.reset || changed)) {
      anim.done = false
      G.frameLoop.start(this)
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
function needsInterpolation(value: unknown): value is string {
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
    : needsInterpolation(value)
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
