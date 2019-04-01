import {
  callProp,
  interpolateTo,
  is,
  toArray,
  withDefault,
  hasKeys,
} from '../shared/helpers'
import AnimatedValue from './AnimatedValue'
import AnimatedValueArray from './AnimatedValueArray'
import { start, stop } from './FrameLoop'
import { colorNames, interpolation as interp, now } from './Globals'
import { SpringProps } from '../../types/renderprops'

type Animation = any
type AnimationMap = { [name: string]: Animation }

type InterpolationMap<DS> = {
  [K in keyof DS]: DS[K] extends ArrayLike<any>
    ? AnimatedValueArray
    : AnimatedValue
}

type UpdateProps<DS extends object> = DS &
  SpringProps<DS> & {
    attach?: (ctrl: Controller) => Animation
  }

type OnEnd = (finished?: boolean) => void

let nextId = 1
class Controller<DS extends object = any> {
  id = nextId++
  idle = true
  guid = 0
  props: UpdateProps<DS> = {} as any
  merged: DS = {} as any
  values: DS = {} as any
  interpolations: InterpolationMap<DS> = {} as any
  animations: AnimationMap = {}
  configs: any[] = []
  queue: any[] = []
  prevQueue: any[] = []
  onEndQueue: OnEnd[] = []
  pendingCount = 0

  getValues = () => this.interpolations

  /**
   * Update the controller by merging the given props into an array of tasks.
   * Individual tasks may be async and/or delayed.
   */
  update(props: UpdateProps<DS>) {
    // Extract delay and the to-prop from props
    const { delay = 0, to, ...restProps } = interpolateTo(props) as any

    // If config is either a function or an array, queue it up as is
    if (is.arr(to) || is.fun(to)) {
      this.queue.push({ ...restProps, delay, to })
    }
    // Otherwise go through each key since it could be delayed individually
    else if (to) {
      let ops: any[] = []
      Object.entries(to).forEach(([k, v]) => {
        // Merge entries with the same delay
        const dt = callProp(delay, k)
        const previous = ops[dt] || {}
        ops[dt] = {
          ...previous,
          ...restProps,
          delay: dt,
          to: { ...previous.to, [k]: v },
        }
      })
      ops.forEach(op => this.queue.push(op))
    }

    // Sort queue, so that async calls go last
    this.queue.sort((a, b) => a.delay - b.delay)

    // Diff the reduced props immediately (they'll contain the from-prop and some config)
    if (hasKeys(restProps)) this._diff(restProps)

    return this
  }

  /**
   * Execute any queued updates, else make sure the frameloop is running.
   * The `useSpring` hooks never have > 1 update per call, because they call this every render.
   */
  start(onEnd?: OnEnd) {
    // If a queue is present we must execute it
    if (this.queue.length) {
      const { prevQueue } = this

      // Updates can interrupt trailing queues, in that case we just merge values
      if (prevQueue.length) {
        prevQueue.forEach(({ from, to }) => {
          if (is.obj(from)) this.merged = { ...from, ...this.merged }
          if (is.obj(to)) this.merged = { ...this.merged, ...to }
        })
        // Reset any queue-related state
        prevQueue.length = 0
        this.pendingCount = 0
        this.onEndQueue.length = 0
      }

      // The guid helps when tracking frames, a new queue over an old one means an override.
      // We discard async calls in that case
      const guid = ++this.guid
      const queue = (this.prevQueue = this.queue)
      this.queue = prevQueue

      // Never assume that the last update always finishes last, since that's
      // not true when 2+ async updates have indeterminate durations.
      let remaining = queue.length
      const didEnd =
        onEnd &&
        ((finished?: boolean) => {
          if (--remaining === 0) onEnd(finished)
        })

      // Go through each entry and execute it
      queue.forEach(({ delay, ...props }) => {
        // Entries can be delayed, async, or immediate
        if (delay) {
          this.pendingCount++
          setTimeout(() => {
            if (guid === this.guid) {
              this.pendingCount--
              this._run(guid, props, didEnd)
            }
          }, delay)
        } else {
          this._run(guid, props, didEnd)
        }
      })
    }
    // Otherwise ensure the frameloop is active
    else this._start(onEnd)
    return this
  }

  // Called by the frameloop
  onFrame(isActive: boolean) {
    if (this.props.onFrame) {
      this.props.onFrame(this.values)
    }
    if (!isActive) {
      this._stop(true)
    }
  }

  stop(finished?: boolean) {
    if (!this.idle || this.pendingCount) {
      this.guid++
      this._stop(finished)
      this.pendingCount = 0
    }
    return this
  }

  destroy() {
    this.stop()
    this.props = {} as any
    this.merged = {} as any
    this.values = {} as any
    this.interpolations = {} as any
    this.animations = {}
    this.configs = []
  }

  // Add this controller to the frameloop
  private _start(onEnd?: OnEnd) {
    if (this.configs.length) {
      if (onEnd) this.onEndQueue.push(onEnd)
      if (this.idle) {
        this.idle = false
        start(this)
      }
    } else if (onEnd) {
      onEnd(true)
    }
  }

  private _stop(finished?: boolean) {
    this.idle = true
    stop(this)
    if (finished && this.props.onRest) {
      this.props.onRest(this.merged)
    }
    if (this.onEndQueue.length) {
      this.onEndQueue.forEach(onEnd => onEnd(finished))
      this.onEndQueue = []
    }
  }

  private _run(guid: number, props: UpdateProps<DS>, onEnd?: OnEnd) {
    // Never call `onStart` for immediate animations
    if (!props.immediate) {
      const { onStart } = props
      // Allow `useCallback` to prevent multiple calls
      if (onStart && onStart !== this.props.onStart) onStart()
    }
    if (is.arr(props.to) || is.fun(props.to)) {
      this._runAsync(guid, props, onEnd)
    } else {
      this._diff(props)._start(onEnd)
    }
  }

  private _runAsync(guid: number, props: UpdateProps<DS>, onEnd?: OnEnd) {
    // If "to" is either a function or an array it will be processed async, therefor "to" should be empty right now
    // If the view relies on certain values "from" has to be present
    let queue = Promise.resolve()

    const { to } = props
    if (is.arr(to)) {
      to.forEach((p, i) => {
        queue = queue.then(() => {
          if (guid !== this.guid) return
          const fresh = { ...props, ...interpolateTo(p) }
          if (is.arr(fresh.config)) fresh.config = fresh.config[i]
          return new Promise<any>(r => this._diff(fresh)._start(r))
        })
      })
    } else if (is.fun(to)) {
      let i = 0
      let last: Promise<any>
      queue = queue.then(() =>
        to(
          // next(props)
          p => {
            if (guid !== this.guid) return
            const fresh = { ...props, ...interpolateTo(p) }
            if (is.arr(fresh.config)) fresh.config = fresh.config[i++]
            return (last = new Promise(r => this._diff(fresh)._start(r)))
          },
          // cancel()
          finished => this.stop(finished)
        ).then(() => last)
      )
    }

    this.pendingCount++
    queue.then(() => {
      if (guid === this.guid) {
        this.pendingCount--
        if (onEnd) onEnd(true)
      }
    })
  }

  private _diff(props: UpdateProps<DS>) {
    this.props = { ...this.props, ...props }
    let {
      from = {} as any,
      to = {} as any,
      config = {},
      reverse,
      attach,
      reset,
      immediate,
    } = this.props

    // Reverse values when requested
    if (reverse) {
      ;[from, to] = [to, from]
    }

    // This will collect all props that were ever set, reset merged props when necessary
    this.merged = { ...from, ...this.merged, ...to }

    // Attachment handling, trailed springs can "attach" themselves to a previous spring
    let target = attach && attach(this)

    // Detect when no animations are changed
    let changed = false

    // Reduces input { name: value } pairs into animated values
    this.animations = Object.entries<any>(this.merged).reduce(
      (acc, [name, value]) => {
        // Issue cached entries, except on reset
        let entry = acc[name] || {}

        // Figure out what the value is supposed to be
        const isNumber = is.num(value)
        const isString =
          is.str(value) &&
          !value.startsWith('#') &&
          !/\d/.test(value) &&
          !colorNames[value]
        const isArray = is.arr(value)
        const isInterpolation = !isNumber && !isArray && !isString

        let fromValue = !is.und(from[name]) ? from[name] : value
        let toValue = isNumber || isArray ? value : isString ? value : 1
        let toConfig = callProp(config, name)
        if (target) toValue = target.animations[name].parent

        let parent = entry.parent,
          interpolation = entry.interpolation,
          toValues = toArray(target ? toValue.getPayload() : toValue),
          animatedValues

        let newValue = value
        if (isInterpolation)
          newValue = interp({
            range: [0, 1],
            output: [value as string, value as string],
          })(1)
        let currentValue = interpolation && interpolation.getValue()

        // Change detection flags
        const isFirst = is.und(parent)
        const isActive =
          !isFirst && entry.animatedValues.some((v: AnimatedValue) => !v.done)
        const currentValueDiffersFromGoal = !is.equ(newValue, currentValue)
        const hasNewGoal = !is.equ(newValue, entry.previous)
        const hasNewConfig = !is.equ(toConfig, entry.config)

        // Change animation props when props indicate a new goal (new value differs from previous one)
        // and current values differ from it. Config changes trigger a new update as well (though probably shouldn't?)
        if (
          reset ||
          (hasNewGoal && currentValueDiffersFromGoal) ||
          hasNewConfig
        ) {
          // Convert regular values into animated values, ALWAYS re-use if possible
          if (isNumber || isString)
            parent = interpolation =
              entry.parent || new AnimatedValue(fromValue)
          else if (isArray)
            parent = interpolation =
              entry.parent || new AnimatedValueArray(fromValue)
          else if (isInterpolation) {
            let prev =
              entry.interpolation &&
              entry.interpolation.calc(entry.parent.value)
            prev = prev !== void 0 && !reset ? prev : fromValue
            if (entry.parent) {
              parent = entry.parent
              parent.setValue(0, false)
            } else parent = new AnimatedValue(0)
            const range = { output: [prev, value] }
            if (entry.interpolation) {
              interpolation = entry.interpolation
              entry.interpolation.updateConfig(range)
            } else interpolation = parent.interpolate(range)
          }

          toValues = toArray(target ? toValue.getPayload() : toValue)
          animatedValues = toArray(parent.getPayload())
          if (reset && !isInterpolation) parent.setValue(fromValue, false)

          // Reset animated values
          animatedValues.forEach(value => {
            value.startPosition = value.value
            value.lastPosition = value.value
            value.lastVelocity = isActive ? value.lastVelocity : undefined
            value.lastTime = isActive ? value.lastTime : undefined
            value.startTime = now()
            value.done = false
            value.animatedStyles.clear()
          })

          // Set immediate values
          if (callProp(immediate, name)) {
            parent.setValue(isInterpolation ? toValue : value, false)
          }

          changed = true
          acc[name] = {
            ...entry,
            name,
            parent,
            interpolation,
            animatedValues,
            toValues,
            previous: newValue,
            config: toConfig,
            fromValues: toArray(parent.getValue()),
            immediate: callProp(immediate, name),
            initialVelocity: withDefault(toConfig.velocity, 0),
            clamp: withDefault(toConfig.clamp, false),
            precision: withDefault(toConfig.precision, 0.01),
            tension: withDefault(toConfig.tension, 170),
            friction: withDefault(toConfig.friction, 26),
            mass: withDefault(toConfig.mass, 1),
            duration: toConfig.duration,
            easing: withDefault(toConfig.easing, (t: number) => t),
            decay: toConfig.decay,
          }
        } else if (!currentValueDiffersFromGoal) {
          // So ... the current target value (newValue) appears to be different from the previous value,
          // which normally constitutes an update, but the actual value (currentValue) matches the target!
          // In order to resolve this without causing an animation update we silently flag the animation as done,
          // which it technically is. Interpolations also needs a config update with their target set to 1.
          if (isInterpolation) {
            parent.setValue(1, false)
            interpolation.updateConfig({ output: [newValue, newValue] })
          }

          changed = true
          parent.done = true
          acc[name] = { ...entry, previous: newValue }
        }
        return acc
      },
      this.animations
    )

    if (changed) {
      const values = (this.values = {} as any)
      const interpolations = (this.interpolations = {} as any)
      for (const key in this.animations) {
        const { interpolation } = this.animations[key]
        values[key] = interpolation.getValue()
        interpolations[key] = interpolation
      }
      // Make animations available to frameloop
      this.configs = Object.values(this.animations)
    }
    return this
  }
}

export default Controller
