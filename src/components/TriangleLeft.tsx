import React from 'react'
import Icon from '../@types/Icon'

/** A left-facing svg triangle. */
const TriangleLeft = ({ fill = 'black', size = 20, width, height, style }: Icon) => (
  <svg
    xmlns=''
    version='1.1'
    width={width || (height ? height / 2 : size)}
    height={height || (width ? width * 2 : size)}
    fill={fill}
    style={style}
    viewBox='0 0 5 10'
  >
    <polygon points='0,5 5,0 5,10' />
  </svg>
)

export default TriangleLeft
