import React, { forwardRef, useRef, Ref, useEffect } from 'react'
import { is, useForceUpdate, useOnce, ElementType, HostConfig } from 'shared'
import { AnimatedProps } from './AnimatedProps'

// For storing the animated version on the original component
const cacheKey = Symbol.for('AnimatedComponent')

type AnimatableComponent = string | Exclude<ElementType, string>

type WithAnimated = {
  (Component: AnimatableComponent): any
  [key: string]: any
}

/** Bind the `hostConfig` to create an `Animated` component factory */
export const withAnimated: {
  bind: (unused: null, hostConfig: HostConfig) => WithAnimated
} = (hostConfig: HostConfig, Component: any) =>
  is.str(Component)
    ? createAnimatedComponent(Component, hostConfig)
    : Component[cacheKey] ||
      (Component[cacheKey] = createAnimatedComponent(Component, hostConfig))

const createAnimatedComponent = (
  Component: any,
  { applyAnimatedValues, getComponentProps = p => p }: HostConfig
) =>
  forwardRef((rawProps: any, ref: Ref<any>) => {
    const node = useRef<any>(null)
    const props = useRef<AnimatedProps | null>(null)

    const forceUpdate = useForceUpdate()
    const nextProps = new AnimatedProps(rawProps, () => {
      if (!node.current) return
      const didUpdate = applyAnimatedValues(
        node.current,
        nextProps.getValue(true)
      )

      // Re-render the component when native updates fail.
      if (didUpdate === false) {
        forceUpdate()
      }
    })

    useEffect(() => {
      const prevProps = props.current
      props.current = nextProps

      // To avoid causing a cascade of detachment, we must detach
      // the old props only *after* the new props are attached.
      nextProps._attach()
      if (prevProps) {
        prevProps._detach()
      }
    })

    // Ensure the latest props are detached on unmount.
    useOnce(() => () => {
      props.current!._detach()
    })

    // Functions cannot have refs (see #569)
    const refFn =
      !is.fun(Component) || Component.prototype.isReactComponent
        ? (value: any) => (node.current = updateRef(ref, value))
        : void 0

    rawProps = getComponentProps(nextProps.getValue())
    return <Component {...rawProps} ref={refFn} />
  })

function updateRef<T>(ref: Ref<T>, value: T) {
  if (ref) {
    if (is.fun(ref)) ref(value)
    else (ref as any).current = value
  }
  return value
}

/**
 * Pass the given components to `withAnimated` and add the newly animated
 * components to `withAnimated` as properties.
 */
export const extendAnimated = (
  withAnimated: WithAnimated,
  components: AnimatableComponent[],
  lowercase?: boolean
): any => {
  components.forEach(Component => {
    let key = getDisplayName(Component)!
    if (lowercase) {
      key = key[0].toLowerCase() + key.slice(1)
    }
    withAnimated[key] = withAnimated(Component)
  })
  return withAnimated
}

const getDisplayName = (arg: AnimatableComponent) =>
  is.str(arg)
    ? arg
    : arg && is.str(arg.displayName)
    ? arg.displayName
    : (is.fun(arg) && arg.name) || null
