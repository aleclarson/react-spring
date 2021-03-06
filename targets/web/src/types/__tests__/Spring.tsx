import React from 'react';
import { assert, test, _ } from 'spec.ts';
import { animated, Spring } from '../..';
import {
  AnimationResult,
  SpringValues,
  SpringUpdateFn,
} from '@react-spring/core';
import { Indexable } from '@react-spring/shared';

const View = animated('div');

test('basic usage', () => {
  <Spring
    from={{ opacity: 0 }}
    to={{ opacity: 1, color: 'blue' }}
    onRest={result => {
      assert(result, _ as AnimationResult<unknown>);
    }}>
    {values => {
      assert(values, _ as SpringValues<{
        // FIXME: should include these
        // opacity: number;
        // color?: string;
      }>);
      return <View style={values} />;
    }}
  </Spring>;
});

test('async "to" prop', () => {
  <Spring
    from={{ opacity: 0 }}
    to={async next => {
      assert(next, _ as SpringUpdateFn<Indexable>); // FIXME: should include "opacity"
    }}>
    {values => {
      assert(values, _ as SpringValues<{
        // FIXME: should include this
        // opacity: number;
      }>);
      return <View style={values} />;
    }}
  </Spring>;
});
