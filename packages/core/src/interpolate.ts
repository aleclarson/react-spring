import { Into } from '@react-spring/animated'
import {
  Constrain,
  OneOrMore,
  Animatable,
  ExtrapolateType,
  InterpolatorConfig,
  InterpolatorFn,
  FluidValue,
} from 'shared/types'
import { deprecateInterpolate } from 'shared/deprecations'

export { Into }

/** Map the value of one or more dependencies */
export const to: Interpolator = (source: any, ...args: [any]) =>
  new Into(source, args)

/** @deprecated Use the `to` export instead */
export const interpolate: Interpolator = (source: any, ...args: [any]) => (
  deprecateInterpolate(), new Into(source, args)
)

/** Extract the raw value types that are being interpolated */
export type Interpolated<T extends ReadonlyArray<any>> = {
  [P in keyof T]: T[P] extends { get(): infer U } ? U : never
}

/**
 * This interpolates one or more `FluidValue` objects.
 * The exported `interpolate` function uses this type.
 */
export interface Interpolator {
  // Single parent
  <In, Out>(
    parent: FluidValue<In>,
    interpolator: InterpolatorFn<In, Out>
  ): Into<Out>

  // Tuple of parents
  <In extends ReadonlyArray<FluidValue>, Out>(
    parents: In,
    interpolator: (...args: Interpolated<In>) => Out
  ): Into<Out>

  // Interpolation config
  <Out>(parents: OneOrMore<FluidValue>, config: InterpolatorConfig<Out>): Into<
    Animatable<Out>
  >

  // Range shortcuts
  <Out>(
    parents: OneOrMore<FluidValue<number>> | FluidValue<number[]>,
    range: readonly number[],
    output: readonly Constrain<Out, Animatable>[],
    extrapolate?: ExtrapolateType
  ): Into<Animatable<Out>>
}
