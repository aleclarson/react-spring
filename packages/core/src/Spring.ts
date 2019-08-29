import { Indexable, Arrify, Merge } from './types/common'
import { SpringConfig, AnimationProps } from './types/spring'
import { is } from '@react-spring/shared'
import { callProp } from './helpers'

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
  key: string
  toValues: Arrify<T>
  fromValues: Arrify<T>
  immediate: boolean
  config: SpringConfig
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

type SpringEvents<T = any> = {
  onStart?: (animation: Animation<T>) => void
  onFrame?: (value: T, key: string) => void
  onRest?: (value: T, key: string) => void
}

type CachedProps = {}

let nextId = 1

/** An opaque animatable value */
export class Spring<T = any> {
  readonly id = nextId++
  /** True when this value has never been animated */
  isNew = true
  /** True when this value cannot be animated */
  isDisposed = false
  /** The animated node that may be a number, array, or interpolation */
  animated?: Animated
  /** The active animation */
  animation?: Animation<T>
  /** Resolved when animation finishes or is cancelled */
  animating?: Promise<{ finished: boolean; value: T }>
  /** The current set of props */
  props: CachedProps
  /** The last time each prop changed */
  timestamps: Indexable<number> = {}
  /** Cancel all updates before this timestamp */
  cancelledAt = 0
  /** The queue of pending props */
  private queue: PendingProps[] = []

  constructor(readonly key: string, defaults?: CachedProps) {
    this.props = defaults ? Object.setPrototypeOf({}, defaults) : {}
  }

  /** Update this value's animation using the given props. */
  update(props: PendingProps) {
    return new Promise(resolve => {
      const delay = callProp(props.delay, this.key)
      if (delay && delay > 0)
        setTimeout(() => this._diff(props, resolve), delay)
      else this._diff(props, resolve)
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
  flush() {}

  private _diff(
    {
      timestamp,
      delay,
      config,
      immediate,
      reverse,
      reset,
      cancel,
      ...props
    }: PendingProps,
    resolve: () => void
  ) {
    let changed = false

    // Generalized diffing algorithm
    const diffProp = (keys: string[], value: any, owner: any) => {
      if (is.und(value)) return
      const lastKey = keys[keys.length - 1]
      if (is.obj(value)) {
        if (!is.obj(owner[lastKey])) owner[lastKey] = {}
        for (const key in value) {
          diffProp(keys.concat(key), value[key], owner[lastKey])
        }
      } else {
        const keyPath = keys.join('.')
        const oldTimestamp = this.timestamps[keyPath]
        if (is.und(oldTimestamp) || timestamp! >= oldTimestamp) {
          this.timestamps[keyPath] = timestamp!
          const oldValue = owner[lastKey]
          if (!isEqual(value, oldValue)) {
            changed = true
            owner[lastKey] = value
          }
        }
      }
    }

    if (reverse) {
      const { to } = props
      props.to = props.from
      props.from = (is.obj(to) ? to : void 0) as any
    }

    for (const key in props) {
      diffProp([key], props[key], this.props)
    }

    // These props only affect one update
    if ('reset' in props) this.props.reset = false
    if ('cancel' in props) this.props.cancel = void 0

    return changed
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

  // Update the props and animations
  private _run(props: PendingProps<State>, onEnd: OnEnd) {
    if (is.arr(props.to) || is.fun(props.to)) {
      this._runAsync(props, onEnd)
    } else if (this._diff(props)) {
      this._animate(props)._start(onEnd)
    } else {
      onEnd()
    }
  }

  // Merge every fresh prop. Returns true if one or more props changed.
  // These props cannot trigger an update by themselves:
  //   [delay, config, immediate, reverse]
  // private _diff({
  //   timestamp,
  //   delay,
  //   config,
  //   immediate,
  //   reverse,
  //   ...props
  // }: PendingProps<State> & Indexable) {
  //   let changed = false

  //   // Generalized diffing algorithm
  //   const diffProp = (keys: string[], value: any, owner: any) => {
  //     if (is.und(value)) return
  //     const lastKey = keys[keys.length - 1]
  //     if (is.obj(value)) {
  //       if (!is.obj(owner[lastKey])) owner[lastKey] = {}
  //       for (const key in value) {
  //         diffProp(keys.concat(key), value[key], owner[lastKey])
  //       }
  //     } else {
  //       const keyPath = keys.join('.')
  //       const oldTimestamp = this.timestamps[keyPath]
  //       if (is.und(oldTimestamp) || timestamp! >= oldTimestamp) {
  //         this.timestamps[keyPath] = timestamp!
  //         const oldValue = owner[lastKey]
  //         if (!isEqual(value, oldValue)) {
  //           changed = true
  //           owner[lastKey] = value
  //         }
  //       }
  //     }
  //   }

  //   if (reverse) {
  //     const { to } = props
  //     props.to = props.from
  //     props.from = (is.obj(to) ? to : void 0) as any
  //   }

  //   for (const key in props) {
  //     diffProp([key], props[key], this.props)
  //   }

  //   // These props only affect one update
  //   if ('reset' in props) this.props.reset = false
  //   if ('cancel' in props) this.props.cancel = void 0

  //   return changed
  // }

  // Return true if the given prop was changed by this update
  private _isModified(props: PendingProps<State>, prop: string) {
    return this.timestamps[prop] === props.timestamp
  }

  // Update the animation configs. The given props override any default props.
  private _animate(props: PendingProps<State>) {
    const { from = emptyObj, to = emptyObj, onAnimate, onStart } = this.props

    if (is.fun(onAnimate)) {
      onAnimate(props as any, this as any)
    }

    let isPrevented = (_: string) => false
    if (props.cancel && this._isModified(props, 'cancel')) {
      // Stop all animations when `cancel` is true
      if (props.cancel === true) {
        this.stop()

        // Prevent pending updates from *before* this update only!
        // (This must come after the `stop` call above)
        this.cancelledAt = props.timestamp!
        return this
      }
      // Prevent matching properties from animating when
      // `cancel` is a string or array of strings
      const keys = toArray(props.cancel)
      if (is.arr(keys) && keys.length) {
        isPrevented = key => keys.indexOf(key) >= 0
        this.stop(...keys)
      }
    }

    // Merge `from` values with `to` values
    this.merged = freeze({ ...from, ...to })

    // True if any animation was updated
    let changed = false

    // The animations that are starting or restarting
    const started: string[] = []

    // Reduces input { key: value } pairs into animation objects
    for (const key in this.merged) {
      if (isPrevented(key)) continue
      const state = this.animations[key] as Animation<any>
      if (!state) {
        console.warn(
          `Failed to animate key: "${key}"\n` +
            `Did you forget to define "from.${key}" for an async animation?`
        )
        continue
      }

      // Reuse the Animated nodes whenever possible
      let { animated, animatedValues } = state

      const value = this.merged[key]
      const goalValue = computeGoalValue(value)
      const currValue = animated.getValue()

      // Stop animations with a goal value equal to its current value.
      if (!props.reset && isEqual(goalValue, currValue)) {
        // The animation might be stopped already.
        if (!state.idle) {
          changed = true
          this._stopAnimation(key)
        }
        continue
      }

      // Replace an animation when its goal value is changed (or it's been reset)
      if (
        props.reset ||
        !isEqual(goalValue, state.isNew ? currValue : state.goalValue)
      ) {
        const immediate = !!callProp(
          (is.und(props.immediate) ? this.props : props).immediate,
          key
        )

        const isActive = animatedValues.some(node => !node.done)
        const fromValue = !is.und(from[key])
          ? computeGoalValue(from[key])
          : goalValue

        // Animatable strings use interpolation
        const isInterpolated = isAnimatableString(value)
        if (isInterpolated) {
          const output: any[] = [props.reset ? fromValue : currValue, goalValue]
          let input = animatedValues[0]
          if (input) {
            input.setValue(0, false)
            input.reset(isActive)
          } else {
            input = new AnimatedValue(0)
          }
          try {
            const prev = animated
            animated = input.to({ output }) as any
            moveChildren(prev, animated)
          } catch (err) {
            console.warn(
              'Failed to interpolate string from "%s" to "%s"',
              output[0],
              output[1]
            )
            console.error(err)
            continue
          }
          if (G.skipAnimation) {
            input.setValue(1)
            this._stopAnimation(key)
            continue
          }
          if (immediate) {
            input.setValue(1, false)
          }
        } else {
          // Convert values into Animated nodes (reusing nodes whenever possible)
          if (is.arr(value)) {
            if (animated instanceof AnimatedArray) {
              if (props.reset) animated.setValue(fromValue, false)
              each(animatedValues, node => node.reset(isActive))
            } else {
              const prev = animated
              animated = createAnimated(fromValue as any[])
              moveChildren(prev, animated)
            }
          } else {
            if (animated instanceof AnimatedValue) {
              if (props.reset) animated.setValue(fromValue, false)
              animated.reset(isActive)
            } else {
              const prev = animated
              animated = new AnimatedValue(fromValue)
              moveChildren(prev, animated)
            }
          }
          if (G.skipAnimation) {
            animated.setValue!(goalValue)
            this._stopAnimation(key)
            continue
          }
          if (immediate) {
            animated.setValue!(goalValue, false)
          }
        }

        // Only change the "config" of updated animations.
        const config: SpringConfig =
          callProp(props.config, key) ||
          callProp(this.props.config, key) ||
          emptyObj

        if (!(immediate || G.skipAnimation)) {
          started.push(key)
        }

        const fromValues: any = animatedValues.map(v => v.getValue())
        const toValues: any = toArray(isInterpolated ? 1 : goalValue)

        changed = true
        this.animations[key] = {
          key,
          idle: false,
          goalValue,
          toValues,
          fromValues,
          animated,
          animatedValues: Array.from(animated.getPayload()),
          immediate,
          duration: config.duration,
          easing: withDefault(config.easing, linear),
          decay: config.decay,
          mass: withDefault(config.mass, 1),
          tension: withDefault(config.tension, 170),
          friction: withDefault(config.friction, 26),
          initialVelocity: withDefault(config.velocity, 0),
          clamp: withDefault(config.clamp, false),
          precision: withDefault(config.precision, 0.005),
          config,
        }
      }
    }

    if (changed) {
      if (started.length) {
        if (is.fun(onStart))
          each(started, key => {
            onStart(this.animations[key] as any)
          })
      }

      // Make animations available to the frameloop
      const keys = Object.keys(this.animations) as StringKeys<State>[]
      this.configs.length = keys.length
      each(keys, (key, i) => {
        const config = this.animations[key]
        this.configs[i] = config
        this.springs[key] = config.animated.getValue()
        this.animated[key] = config.animated
      })
    }
    return this
  }

  /**
   * Stop an animation by its key.
   *
   * This mutates the `timestamps.to[key]`, `props.to[key]`, and `animations[key]` properties.
   * Notably, it does *not* mutate the `configs[key]` or `animated[key]` properties.
   */
  private _stopAnimation(key: StringKeys<State>, isNew?: boolean) {
    const animated = this.animated[key]
    if (!animated) {
      return console.warn(
        `Cannot stop an animation for a key that isn't animated: "${key}"`
      )
    }

    // Prevent any pending updates to this key
    this.timestamps['to.' + key] = G.now()

    // Idle animations are skipped unless their Animated node changed
    const state = this.animations[key] || emptyObj
    if (state.idle && animated === state.animated) return

    // Use the previous `isNew` value if nothing was passed
    if (is.und(isNew)) {
      isNew = !!state.isNew
    }

    // Tell the frameloop to skip animating these values
    const animatedValues = Array.from(animated.getPayload())
    each(animatedValues, node => {
      node.done = true
    })

    // The current value becomes the goal value,
    // which ensures the integrity of the diffing algorithm.
    const goalValue = animated.getValue()
    if (this.props.to) {
      this.props.to[key] = goalValue
    }

    // Remove unused data from this key's animation config
    this.animations[key] = {
      key,
      idle: true,
      isNew,
      goalValue,
      animated,
      animatedValues,
    }
  }

  // Create an Animated node if none exists.
  private _ensureAnimated(values: unknown, shouldUpdate = false) {
    if (!is.obj(values)) return
    for (const key in values as Partial<State>) {
      const value = values[key]
      let animated: any = this.animated[key]
      if (animated && shouldUpdate && this.animations[key].isNew) {
        // Ensure the initial value is up-to-date.
        if (animated.setValue) {
        } else {
          // Derived nodes need to be swapped out.
          animated = null
        }
      }
      if (!animated) {
        animated = createAnimated(value)
        if (this.animated[key]) {
          // Swap out the old node with the new node.
          moveChildren(this.animated[key], animated)
        }
        this.animated[key] = animated
        this._stopAnimation(key, true)
      }
    }
  }
}
