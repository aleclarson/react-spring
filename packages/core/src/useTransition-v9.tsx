import React, { useRef, useEffect, useMemo } from 'react'
import { callProp, interpolateTo } from './helpers'
import { is, toArray, useForceUpdate, useOnce, usePrev } from 'shared'
import { Controller } from './Controller'

export function useTransition<T>(
  data: T | readonly T[],
  props: any,
  deps?: any[]
) {
  const state = useDiff(data, props)

  const forceUpdate = useForceUpdate()
  useEffect(() => {
    // Execute any animations
    state.changes.forEach(change => {
      // TODO
    })
  }, deps)

  const render = (render: any) =>
    state.items.map(item => {
      const { id, spring } = transitions.get(item)!
      const elem = render({ ...spring.animated }, item)
      return elem && elem.type ? (
        <elem.type {...elem.props} key={id} ref={elem.ref} />
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
  changes: Map<number, Change>
  /** Each item mapped to its transition state */
  transitions: Map<T, Transition<T>>
}

interface Change {
  spring: Controller
  phase: Phase
  props: any
}

interface Transition<T = any> {
  id: number
  item: T
  phase: Phase
  spring: Controller
}

const enum Phase {
  /** This item is mounted but waiting to enter */
  Mount,
  /** This item is entering or has entered */
  Enter,
  /** This item has animated since entering */
  Update,
  /** This item will be unmounted */
  Leave,
}

function useDiff<T>(data: T | readonly T[], props: any): State {
  const items = toArray(data)
  const prevItems = usePrev(items) || []

  const hasNewData = data !== usePrev(data)
  const mountedItems = hasNewData
    ? // Prepend all deleted items when `data` argument is new
      findDeleted(items, prevItems).concat(items)
    : // Find where deleted items once existed
      mergeDeleted(items, prevItems)

  const { trail = 0 } = props
  let delay = -trail

  const transitions = useMemo(() => new Map<T, Transition<T>>(), [])
  const mounted = useRef(false)
  useOnce(() => {
    mounted.current = true
    return () => transitions.forEach(t => t.spring.destroy())
  })

  const changes: Change[] = []
  mountedItems.forEach((item, i) => {
    const t = transitions.get(item)

    let change: any
    if (t && t.phase < Phase.Leave) {
      if (items.indexOf(item) < 0) {
        change = { spring: t.spring, phase: Phase.Leave }
      } else if (props.update) {
        change = { spring: t.spring, phase: Phase.Update }
      }
    } else {
      change = t
        ? { spring: t.spring, phase: Phase.Enter }
        : { spring: new Controller(), phase: Phase.Mount }
    }

    if (change) {
      let p = callProp(change.props)
      const p: any = {
        config: callProp(props.config, item, i),
      }

      p.delay = delay += trail
      changes.push({
        id,
        phase,
        props: p,
      })
    }
  })

  return {
    items: mountedItems,
    changes,
  }
}

function mergeDeleted<T>(items: T[], prevItems: T[]) {
  const mutuals: number[] = []
  items.forEach((item, index) => {
    // Mutual items exist in both arrays.
    const prevIndex = prevItems.indexOf(item)
    if (~prevIndex) mutuals[prevIndex] = index
  })
  if (mutuals.length) {
    // Ensure deleted items at the end are inserted.
    mutuals[prevItems.length] = items.length
    // Create the merged array.
    let i = 0
    const merged = [...items]
    mutuals.forEach((index, prevIndex) => {
      // Insert every deleted item that came before the mutual item.
      if (i < prevIndex) {
        merged.splice(index, 0, ...prevItems.slice(i, prevIndex))
      }
      // Go past the mutual item.
      i = prevIndex + 1
    })
    // All merged! 🥳
    return merged
  }
  // All items are new.
  return items
}

function findDeleted<T>(items: T[], prevItems: T[]) {
  return prevItems.filter(item => items.indexOf(item) < 0)
}
