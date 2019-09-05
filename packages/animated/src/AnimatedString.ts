import { AnimatedInterpolation } from './AnimatedInterpolation'
import { AnimatedValue } from './AnimatedValue'

export class AnimatedString extends AnimatedInterpolation<[number], string> {
  source!: AnimatedValue

  constructor(from: string, to: string) {
    super(new AnimatedValue(0), [{ output: [from, to] }])
  }

  static create(from: string, to: string | null) {
    if (to == null) {
      throw TypeError('Expected "to" to be a string')
    }
    return new AnimatedString(from, to)
  }

  setValue(value: number) {
    this.source.setValue(value)
  }

  reset(isActive: boolean) {
    this.setValue(0)
    this.source.reset(isActive)
  }
}
