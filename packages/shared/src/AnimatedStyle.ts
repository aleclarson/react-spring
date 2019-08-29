import { AnimatedObject } from '../../animated/src/AnimatedObject'
import * as G from 'shared/globals'

type Style = object & { transform?: any }

export const createAnimatedStyle = (style: Style) => new AnimatedStyle(style)

export class AnimatedStyle extends AnimatedObject {
  constructor(style = {} as Style) {
    super(
      style.transform && G.createAnimatedTransform
        ? { ...style, transform: G.createAnimatedTransform(style.transform) }
        : style
    )
  }
}
