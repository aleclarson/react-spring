import {
  each,
  is,
  Indexable,
  FluidValue,
  OneOrMore,
  isFluidValue,
  toArray,
} from 'shared'
import {
  AnimatedObject,
  AnimatedValue,
  AnimationValue,
} from '@react-spring/animated'

/** The transform-functions
 * (https://developer.mozilla.org/fr/docs/Web/CSS/transform-function)
 * that you can pass as keys to your animated component style and that will be
 * animated. Perspective has been left out as it would conflict with the
 * non-transform perspective style.
 */
const domTransforms = /^(matrix|translate|scale|rotate|skew)/

// These keys have "px" units by default
const pxTransforms = /^(translate)/

// These keys have "deg" units by default
const degTransforms = /^(rotate|skew)/

type Value = number | string

/** Add a unit to the value when the value is unit-less (eg: a number) */
const addUnit = (value: Value, unit: string): string | 0 =>
  is.num(value) && value !== 0 ? value + unit : value

/**
 * Checks if the input value matches the identity value.
 *
 *     isValueIdentity(0, 0)              // => true
 *     isValueIdentity('0px', 0)          // => true
 *     isValueIdentity([0, '0px', 0], 0)  // => true
 */
const isValueIdentity = (value: OneOrMore<Value>, id: number): boolean =>
  is.arr(value)
    ? value.every(v => isValueIdentity(v, id))
    : is.num(value)
    ? value === id
    : parseFloat(value) === id

/** Coerce any `FluidValue` to its current value */
const getValue = <T>(value: T | FluidValue<T>) =>
  isFluidValue(value) ? value.get() : value

type Inputs = ReadonlyArray<Value | FluidValue<Value>>[]
type Transforms = ((value: any) => [string, boolean])[]

/**
 * This AnimatedStyle will simplify animated components transforms by
 * interpolating all transform function passed as keys in the style object
 * including shortcuts such as x, y and z for translateX/Y/Z
 */
export class AnimatedStyle extends AnimatedObject {
  constructor({ x, y, z, ...style }: Indexable) {
    /**
     * An array of arrays that contains the values (static or fluid)
     * used by each transform function.
     */
    const inputs: Inputs = []
    /**
     * An array of functions that take a list of values (static or fluid)
     * and returns (1) a CSS transform string and (2) a boolean that's true
     * when the transform has no effect (eg: an identity transform).
     */
    const transforms: Transforms = []

    // Combine x/y/z into translate3d
    if (x || y || z) {
      inputs.push([x || 0, y || 0, z || 0])
      transforms.push((xyz: Value[]) => [
        `translate3d(${xyz.map(v => addUnit(v, 'px')).join(',')})`, // prettier-ignore
        isValueIdentity(xyz, 0),
      ])
    }

    // Pluck any other transform-related props
    each(style, (value, key: any) => {
      if (key === 'transform') {
        inputs.push([value || ''])
        transforms.push((transform: string) => [transform, transform === ''])
      } else if (domTransforms.test(key)) {
        delete style[key]
        if (is.und(value)) return

        const unit = pxTransforms.test(key)
          ? 'px'
          : degTransforms.test(key)
          ? 'deg'
          : ''

        inputs.push(toArray(value))
        transforms.push(
          key === 'rotate3d'
            ? ([x, y, z, deg]: [number, number, number, Value]) => [
                `rotate3d(${x},${y},${z},${addUnit(deg, unit)})`,
                isValueIdentity(deg, 0),
              ]
            : (input: Value[]) => [
                `${key}(${input.map(v => addUnit(v, unit)).join(',')})`,
                isValueIdentity(input, key.startsWith('scale') ? 1 : 0),
              ]
        )
      }
    })

    if (inputs.length) {
      style.transform = new SpringTransform(inputs, transforms)
    }

    super(style)
  }
}

class SpringTransform extends AnimationValue<string> {
  node: AnimatedValue<string>

  constructor(readonly inputs: Inputs, readonly transforms: Transforms) {
    super()
    this.node = new AnimatedValue(this._compute())
  }

  // Required by `AnimationValue` but never used.
  get idle() {
    return true
  }

  protected _compute() {
    let transform = ''
    let identity = true
    each(this.inputs, (input, i) => {
      const [t, id] = this.transforms[i](input.map(getValue))
      transform += ' ' + t
      identity = identity && id
    })
    return identity ? 'none' : transform
  }

  /** @internal */
  protected _attach() {
    // Start observing our inputs once we have an observer.
    each(this.inputs, input =>
      each(input, value => isFluidValue(value) && value.addChild(this))
    )
  }

  /** @internal */
  protected _detach() {
    // Stop observing our inputs once we have no observers.
    each(this.inputs, input =>
      each(input, value => isFluidValue(value) && value.removeChild(this))
    )
  }

  /** @internal */
  onParentChange() {
    // TODO: only compute once per frame max
    const value = this._compute()
    this.node.setValue(value)
    this._onChange(value, true)
  }
}
