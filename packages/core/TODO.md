# Controller

The `Controller` class applies default values to each prop before pushing the props object to each `Spring`'s queue.

- `props` in `useSpring(props)` replaces all props from previous render
- `props` in `useSprings(() => props)` is the initial props
- async `to` functions can be nested
- `update` calls with async `to` function don't resolve their promise until `to` concludes
- `onRest` and `onFrame` are passed `(values)` when stored in Controller, else `(key, value)` when stored in Spring
- the Controller does no flushing. just setup each update and send it to Spring for flushing
- one-time props, persistent props

# Spring

- state
  - initialProps
  -
- actions
  - get value
  - update animation
  - stop animation
