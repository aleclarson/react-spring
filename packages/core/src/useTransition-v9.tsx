import React, { useEffect, useRef } from 'react'
import { callProp, interpolateTo } from './helpers'
import { is, toArray, useForceUpdate, useOnce } from 'shared'
import { Controller } from './Controller'
import { now } from 'shared/globals'

export function useTransition<T>(
  data: T | readonly T[],
  props: any,
  deps?: any
) {
  const { ref, reset } = props
  const { items, changes, transitions } = useDiff(data, props)

  useEffect(
    () => {
      for (const { item, phase, spring, payload } of changes) {
        transitions.set(item, { phase, spring })
        if (payload) spring.update(payload)
        if (!ref) spring.start()
      }
    },
    reset ? void 0 : deps
  )

  // TODO: memoize elements for deleted items
  const render = (render: any) =>
    items.map(item => {
      const { spring } = transitions.get(item)!
      const elem = render({ ...spring.animated }, item)
      return elem && elem.type ? (
        <elem.type {...elem.props} key={spring.id} ref={elem.ref} />
      ) : (
        elem
      )
    })

  return render
}

interface State<T = any> {
  /** The user-provided items (with deleted items still intact) */
  items: readonly T[]
  /** Controller updates (by transition ID) to be applied once rendered */
  changes: Change[]
  /** Each item mapped to its transition state */
  transitions: Map<T, Transition>
}

interface Change<T = any> {
  /** The newest transition state */
  transition: Transition<T>
  /** The newest controller props */
  payload?: any
}

interface Transition<T = any> {
  id: number
  item: T
  phase: Phase
  spring: Controller
  /** Destroy no later than this date */
  expiresBy?: number
  expirationId?: number
}

const enum Phase {
  /** This transition is being mounted */
  Mount,
  /** This transition is entering or has entered */
  Enter,
  /** This transition had its animations updated */
  Update,
  /** This transition will expire after animating */
  Leave,
}

function useDiff<T>(data: T | readonly T[], props: any): State {
  const { reset, trail = 0, expires = Infinity } = props

  const items = toArray(data)
  const transitions: Transition[] = []

  // The "onRest" callbacks need a ref to the latest transitions.
  const usedTransitions = useRef<Transition[] | null>(null)
  useEffect(() => {
    usedTransitions.current = transitions
  })

  // Track the first render for the "initial" prop.
  const isFirst = reset || !usedTransitions.current

  let newItems = items
  if (!isFirst) {
    usedTransitions.current!.forEach(t => {
      if (is.und(t.expiresBy)) {
        transitions.push(t)
      } else {
        clearTimeout(t.expirationId)
      }
    })

    // Deduce which items are new.
    const oldItems = transitions.map(t => t.item)
    newItems = newItems.filter(item => oldItems.indexOf(item) < 0)
  }

  // Append transitions for new items.
  items.forEach(item => {
    const spring = new Controller()
    transitions.push({ id: spring.id, item, phase: Phase.Mount, spring })
  })

  // Track cumulative delay for the "trail" prop.
  let delay = -trail

  // Generate changes to apply in useEffect.
  const changes: Change[] = []
  transitions.forEach((t, i) => {
    let to: any
    let phase: Phase
    if (t.phase == Phase.Mount) {
      to = (isFirst && props.initial) || props.enter
      phase = Phase.Enter
    } else {
      const isDeleted = items.indexOf(t.item) < 0
      if (t.phase < Phase.Leave) {
        if (isDeleted) {
          to = props.leave
          phase = Phase.Leave
        } else if ((to = props.update)) {
          phase = Phase.Update
        } else return
      } else if (!isDeleted) {
        to = props.enter
        phase = Phase.Enter
      } else return
    }

    const payload: any = {
      // When "to" is a function, it can return (1) an array of "useSpring" props,
      // (2) an async function, or (3) an object with any "useSpring" props.
      to: to = callProp(to, t.item, i),
      from: phase <= Phase.Enter ? callProp(props.from, item, i) : void 0,
      delay: delay += trail,
      config: callProp(props.config, item, i),
      ...(is.obj(to) && interpolateTo(to)),
    }

    const { onRest } = payload
    payload.onRest = (values: any) => {
      if (is.fun(onRest)) {
        onRest(values)
      }
      if (expires <= 0) {
        forceUpdate()
      } else {
        // Postpone dismounts while other controllers are active.
        const transitions = usedTransitions.current!
        if (Array.from(transitions.values()).every(t => t.spring.idle)) {
          forceUpdate()
        } else {
          t.expiresBy = now() + expires
          if (expires < Infinity) {
            t.expirationId = setTimeout(() => {
              // TODO: dismount all resting deleted items
            }, expires)
          }
        }
      }
    }

    // To ensure any Animated nodes exist during render, the payload must be
    // applied immediately for Controller objects created this render.
    const change: Change = { item, phase, spring }
    if (t) change.payload = payload
    else spring.update(payload)
    changes.push(change)
  })

  // Destroy all transitions on dismount.
  useOnce(() => () => {
    usedTransitions.current!.forEach(t => t.spring.destroy())
  })

  return {
    items: mountedItems,
    changes,
    transitions,
  }
}
