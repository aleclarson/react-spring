import React, { useRef, useEffect, useState, ReactNode } from 'react'
import { callProp, interpolateTo } from './helpers'
import { is, toArray, useForceUpdate, usePrev } from 'shared'
import { Controller } from './Controller'
import { now } from 'shared/globals'

export function useTransition<T>(
  data: T | readonly T[],
  props: any,
  deps?: any
) {
  const { ref, reset } = props
  const { items, changes, transitions } = useDiff(data, props)

  const forceUpdate = useForceUpdate()
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

  // TODO: memoize elements for deleted items when recycling is disabled
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
  /** Memoized element for deleted items */
  element?: ReactNode
  /** Destroy no later than this date */
  expiresAt?: number
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

  // 1. find mutual items
  // 2. insert new transitions into copy of accumulated transitions
  //    and populate an array of changed transitions
  // 3. omit expired transitions from copy of accumulated transitions
  // 4. use memoized elements for deleted items

  // The transition list is recreated on each render.
  const transitions: Transition[] = []
  const prevTransitions = usePrev(transitions)
  if (prevTransitions && !reset) {
    prevTransitions.forEach(t => {
      if (t.phase < Phase.Leave) {
      }
    })
  }

  // The transition list is *never* mutated during render, so the "reset" prop
  // must create a temporary map instead of clearing the existing map.
  const usedTransitions = useRef<Map<T, Transition> | null>(null)
  const transitions = (!reset && usedTransitions.current) || new Map()
  useEffect(() => {
    usedTransitions.current = transitions
    return () => {
      transitions.forEach(t => t.spring.destroy())
    }
  }, [transitions])

  // Expired items must be omitted from "mountedItems".
  const expired = useRef<T[] | null>(null)
  const expiredItems = expired.current
  useEffect(() => {
    if (expiredItems) {
      expired.current = null
      expiredItems.forEach(() => {
        transitions.delete
      })
    }
  }, [expiredItems])

  // Track the first render for the "initial" prop.
  const isFirst = transitions !== usedTransitions.current

  // Track cumulative delay for the "trail" prop.
  let delay = -trail

  // Generate the changes to apply in useEffect.
  const changes: Change[] = []
  mountedItems.forEach((item, i) => {
    const t = transitions.get(item)

    let to: any
    let phase: Phase
    if (t && t.phase < Phase.Leave) {
      if (items.indexOf(item) < 0) {
        to = props.leave
        phase = Phase.Leave
      } else if ((to = props.update)) {
        phase = Phase.Update
      } else return
    } else {
      to = (isFirst && props.initial) || props.enter
      phase = t ? Phase.Enter : Phase.Mount
    }

    const spring = t ? t.spring : new Controller()
    const payload: any = {
      // When "to" is a function, it can return (1) an array of "useSpring" props,
      // (2) an async function, or (3) an object with any "useSpring" props.
      to: to = callProp(to, item, i),
      from: phase <= Phase.Enter ? callProp(props.from, item, i) : void 0,
      delay: delay += trail,
      config: callProp(props.config, item, i),
      ...(is.obj(to) && interpolateTo(to)),
    }

    /** Find items whose leave animations have finished */
    function findExpired<T>(transitions: Map<T, Transition>) {
      const items: T[] = []
      transitions.forEach((t, item) => {
        if (!is.und(t.expiresAt)) {
          // TODO
        }
      })
    }

    const { onRest } = payload
    payload.onRest = (values: any) => {
      if (is.fun(onRest)) {
        onRest(values)
      }
      if (expires <= 0) {
        // TODO: dismount all resting deleted items
      } else {
        // Postpone dismounts while other controllers are active.
        const transitions = usedTransitions.current!
        if (Array.from(transitions.values()).every(t => t.spring.idle)) {
          // TODO: dismount all resting deleted items
        } else {
          const t = transitions.get(item)!
          t.expiresAt = now() + expires
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

  return {
    items: mountedItems,
    changes,
    transitions,
  }
}
