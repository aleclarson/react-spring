import { SpringInterpolator } from './animated'

export interface HostConfig {
  /** Provide custom logic for native updates */
  applyAnimatedValues: (node: any, props: any) => boolean | void
  /** Provide a custom `interpolate` function */
  createAnimatedInterpolation: SpringInterpolator
  /** Wrap the `transform` prop with an animated node */
  createAnimatedTransform?: (transform: any) => any
  /** Wrap the `style` prop with an animated node */
  createAnimatedStyle?: (style: any) => any
  /** Intercept props before they're passed to an animated component */
  getComponentProps?: (props: any) => any
  /** Provide custom color names for interpolation */
  colorNames?: { [key: string]: number }
}
