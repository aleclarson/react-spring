import {
  is,
  each,
  OneOrMore,
  toArray,
  UnknownProps,
  UnknownPartial,
  FluidProps,
} from 'shared'
import * as G from 'shared/globals'

import { SpringUpdate, SpringValues } from './types/spring'
import {
  OnAnimate,
  OnRest,
  OnStart,
  OnChange,
  AnimationResult,
} from './types/animated'
import { Indexable, Falsy } from './types/common'
import {
  runAsync,
  scheduleProps,
  RunAsyncState,
  AsyncResult,
  RunAsyncProps,
} from './runAsync'
import { SpringPhase, CREATED, ACTIVE, IDLE } from './SpringPhase'
import { interpolateTo, callProp } from './helpers'
import { SpringValue } from './SpringValue'
import { FrameValue } from './FrameValue'

// These events are batched once per frame.
const EVENT_NAMES = [
  'onFrame',
  'onStart',
  'onRest',
  'onChange',
  'onAnimate',
] as const

/** A callback that receives the changed values for each frame. */
export type OnFrame<State extends Indexable> = (
  frame: UnknownPartial<State>
) => void

/** All event props supported by the `Controller` class */
export interface EventProps<State extends Indexable> {
  /**
   * Called on every frame when animations are active
   */
  onFrame?: OnFrame<State>
  /**
   * Called when the # of animating values exceeds 0
   *
   * Also accepts an object for per-key events
   */
  onStart?: (() => void) | { [P in keyof State]: OnStart<State[P]> }
  /**
   * Called when the # of animating values hits 0
   *
   * Also accepts an object for per-key events
   */
  onRest?: OnRest<State> | { [P in keyof State]: OnRest<State[P]> }
  /**
   * Called whenever an animation is updated
   *
   * Also accepts an object for per-key events
   */
  onAnimate?: OnAnimate | { [P in keyof State]: OnAnimate<State[P]> }
  /**
   * Called for every change to a key/value pair
   *
   * Also accepts an object for per-key events
   */
  onChange?: OnChange | { [P in keyof State]: OnChange<State[P]> }
}

export type ControllerProps<State extends Indexable = Indexable> = unknown &
  EventProps<State> &
  SpringUpdate<State> &
  UnknownPartial<FluidProps<State>>

/** The props that are cached by `Controller` objects */
interface CachedProps<State extends Indexable>
  extends EventProps<State>,
    RunAsyncState<State> {}

/** An update that hasn't been applied yet */
type PendingProps<State extends Indexable> = ControllerProps<State> & {
  keys: string[]
}

let nextId = 1
let lastAsyncId = 0

export class Controller<State extends Indexable = UnknownProps>
  implements FrameValue.Observer {
  readonly id = nextId++

  /** The queue of pending props */
  queue: PendingProps<State>[] = []

  /** Fallback values for undefined props */
  defaultProps: EventProps<State> = {}

  /** The combined phase of our spring values */
  protected _phase: SpringPhase = CREATED

  /** The values currently being animated */
  protected _active = new Set<FrameValue>()

  /** The animated state that changed in the last animation frame */
  protected _frame: UnknownPartial<State> = {}

  /** The frame listener when batched events are used */
  protected _onFrame: (() => void) | false = false

  /** Event handlers and async state are stored here */
  protected _state: CachedProps<State> = {}

  /** The spring values that manage their animations */
  protected _springs: Indexable<SpringValue> = {}

  /** The animation results of each spring. Used for batched `onRest` calls. */
  protected _results = new Map<SpringValue, AnimationResult>()

  constructor(props?: ControllerProps<State>) {
    if (props) {
      props.default = true
      this.start(props)
    }
  }

  /** Equals true when no springs are animating */
  get idle() {
    return !(this._state.promise || this._active.size)
  }

  /** Get all existing `SpringValue` objects. This clones the internal store. */
  get springs() {
    return { ...this._springs } as SpringValues<State>
  }

  /** Get an existing `SpringValue` object by its key. */
  get<P extends keyof State>(key: P): SpringValue<State[P]>
  get(key: string): SpringValue<unknown> | undefined
  get(key: string) {
    return this._springs[key as any]
  }

  /** Push an update onto the queue of each value. */
  update(props: ControllerProps<State> | Falsy) {
    if (props) this.queue.push(this._update(props))
    return this
  }

  /**
   * Start the queued animations for every spring, and resolve the returned
   * promise once all queued animations have finished or been cancelled.
   *
   * When you pass a queue (instead of nothing), that queue is used instead of
   * the queued animations added with the `update` method, which are left alone.
   */
  async start(queue?: OneOrMore<ControllerProps<State>>) {
    if (queue) {
      queue = toArray<any>(queue).map(props => this._update(props))
    } else {
      queue = this.queue
      this.queue = []
    }

    const promises: AsyncResult[] = []
    each(queue as PendingProps<State>[], props => {
      const { to, keys, onRest } = props

      const asyncTo = (is.arr(to) || is.fun(to)) && to
      if (asyncTo) {
        props.to = undefined
      }

      if (is.fun(onRest)) {
        // Track the animations of each spring individually.
        props.onRest = result => {
          this._results.set(result.spring!, result)
        }
      }

      // Send updates to every affected key.
      each(keys, key => {
        const promise = this._springs[key].start(props as any)
        promises.push(promise)
      })

      // Schedule controller-only props.
      const state = this._state
      promises.push(
        scheduleProps(++lastAsyncId, {
          props,
          state,
          action: (props, resolve) => {
            if (!props.cancel) {
              props.onRest = onRest
              this._setState(props)
            }

            // Start, replace, or cancel the async animation.
            if (asyncTo) {
              resolve(
                runAsync<State>(
                  asyncTo,
                  props,
                  state,
                  this._get.bind(this),
                  () => false, // TODO: add pausing to Controller
                  this.start.bind(this) as any,
                  this.stop.bind(this) as any
                )
              )
            } else {
              resolve({
                value: 0, // This value gets ignored.
                finished: !props.cancel,
              })
            }
          },
        })
      )
    })

    const results = await Promise.all(promises)
    return {
      value: this._get(),
      finished: results.every(result => result.finished),
    }
  }

  /** Stop one animation, some animations, or all animations */
  stop(keys?: OneOrMore<string>) {
    if (is.und(keys)) {
      each(this._springs, spring => spring.stop())
    } else {
      each(toArray(keys), key => this._springs[key].stop())
    }
    return this
  }

  /** Restart every animation. */
  reset() {
    each(this._springs, spring => spring.reset())
    // TODO: restart async "to" prop
    return this
  }

  /** Destroy every spring in this controller */
  dispose() {
    this._state.asyncTo = undefined
    each(this._springs, spring => spring.dispose())
    this._springs = {}
  }

  /** Get the current value of every spring */
  protected _get() {
    const values: any = {}
    each(this._springs, (spring, key) => {
      values[key] = spring.get()
    })
    return values
  }

  /** Create a spring for every given key, and ensure they have `Animated` nodes. */
  protected _setSprings(keys: any[], from?: object, to?: object) {
    each(keys, key => {
      if (!this._springs[key]) {
        const spring = (this._springs[key] = new SpringValue())
        spring.key = key
        spring.addChild(this)
        spring.setNodeWithProps({ from, to })
      }
    })
  }

  /** Prepare an update with the given props. */
  protected _update(propsArg: ControllerProps<State>) {
    const props: PendingProps<State> = interpolateTo(propsArg) as any
    props.keys = extractKeys(props, this._springs)

    let { from, to } = props as any

    // Avoid sending async "to" prop to springs.
    if (is.arr(to) || is.fun(to)) {
      to = undefined
    }

    // Create our springs and give them values.
    if (from || to) {
      this._setSprings(props.keys, from, to)
    }

    return props
  }

  /** Update our internal state with the given props. */
  protected _setState(props: PendingProps<State> & RunAsyncProps) {
    let needsOnFrame = false
    each(EVENT_NAMES, key => {
      const value: any = props[key] || this.defaultProps[key]
      if (value && props.default) {
        this.defaultProps[key] = value
      }
      this._state[key] = value
      if (is.fun(value)) {
        needsOnFrame = true
      }
    })
    this._onFrame =
      needsOnFrame &&
      (() => {
        const { onFrame, onStart, onRest } = this._state

        const isActive = this._active.size > 0
        if (isActive !== (this._phase == ACTIVE)) {
          this._phase = isActive ? ACTIVE : IDLE
          callProp(isActive ? onStart : onRest)
        }

        if (onFrame) {
          onFrame(this._frame)
          this._frame = {}
        }
      })
  }

  /** @internal */
  onParentChange(event: FrameValue.Event) {
    if (event.type == 'change') {
      const state = this._state
      if (state.onFrame) {
        this._frame[event.parent.key as keyof State] = event.value
      }
      this._active[event.idle ? 'delete' : 'add'](event.parent)
      if (EVENT_NAMES.some(key => is.fun(state[key]))) {
        G.frameLoop.onFrame(this._onFrame)
      }
    }
  }
}

/** Determine which keys should receive an update */
function extractKeys(props: ControllerProps, springs: Indexable<SpringValue>) {
  const keys = new Set<string>()

  /** Collect keys with a defined value */
  const getDefinedKeys = (obj: Indexable) =>
    each(obj, (value, key) => {
      if (!is.und(value)) {
        keys.add(key as string)
      }
    })

  const { from, to } = props
  if (is.obj(to)) getDefinedKeys(to)
  if (from) getDefinedKeys(from)

  // When neither "from" or "to" have a key with a defined value,
  // return the keys for every existing spring.
  return keys.size ? Array.from(keys) : Object.keys(springs)
}
