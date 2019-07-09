## State

- one `Controller` per item
- array of deleted items
-

## Existing Behavior

- Duplicates cannot exist in the `items` argument
- On each render, update item phases and create new controllers
- Once any leave animations finish, clean up the internal state and force a re-render
- Let phased props be functions that are called once per item
- On dismount, destroy all controllers

### props.lazy

See here: https://github.com/react-spring/react-spring.io/issues/5#issuecomment-480204272

### props.unique

For reusing deleted items when they are re-added before their leave animation is finished.

### props.update

For updating the goal values on re-render. Most useful for reorder animations.

### props.reset

Reset every item to the "enter" phase (or the "initial" phase).

## New Behavior

- Instead of returning a transitions array, return a function that maps the transitions for you
- Duplicate items are forbidden
- Unique mode is the new default
- In non-unique mode, leave transitions have their elements memoized
- Lazy mode is the new default
- Laziness is configurable via the `expires` prop
  - For immediate dismount after leave, set `expires` to 0
  - To prevent dismount until all transitions finish, set `expires` to null or Infinity

### Performance

- Mutate transitions instead of cloning them
