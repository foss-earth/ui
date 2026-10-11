export const LOG_DOCK_GAP = 12;

export interface LogResizeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The right edge follows the pointer; centered logs mirror it on the left, and
 * a log against the right edge of the screen moves its left edge instead.
 */
export function fitLogResize(input: {
  origin: LogResizeBox;
  dx: number;
  dy: number;
  centered?: boolean;
  rightAligned?: boolean;
  minLeft: number;
  maxRight: number;
  minWidth: number;
  minHeight: number;
  maxHeight: number;
}): LogResizeBox | null {
  const originRight = input.origin.left + input.origin.width;
  const right = input.rightAligned ? originRight : Math.min(input.maxRight, originRight + input.dx);
  const left = Math.max(input.minLeft, input.rightAligned
    ? input.origin.left + input.dx
    : input.origin.left - (input.centered === false ? 0 : input.dx));
  const width = right - left;
  if (width < input.minWidth) return null;
  const height = Math.max(
    input.minHeight,
    Math.min(input.maxHeight, input.origin.height + input.dy),
  );
  return { left, top: input.origin.top, width, height };
}
