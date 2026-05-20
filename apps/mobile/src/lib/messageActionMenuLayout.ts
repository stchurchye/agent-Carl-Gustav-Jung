import type { MessageBubbleAnchor } from '../components/chat/MessageBubbleAnchor';

export const MESSAGE_ACTION_MENU_METRICS = {
  itemWidth: 56,
  padH: 10,
  height: 58,
  arrow: 6,
  gap: 5,
  insidePad: 8,
  screenEdge: 10,
} as const;

export type MessageActionMenuPlacement =
  | 'outsideAbove'
  | 'insideTop'
  | 'outsideBelow'
  | 'insideBottom'
  | 'aboveCompose';

export type MessageActionMenuLayout = {
  left: number;
  top: number;
  menuWidth: number;
  menuHeight: number;
  arrowLeft: number;
  placement: MessageActionMenuPlacement;
  arrowAtTop: boolean;
};

export type RectAnchor = { x: number; y: number; width: number; height: number };

function menuWidthForItems(itemCount: number): number {
  const { itemWidth, padH } = MESSAGE_ACTION_MENU_METRICS;
  return itemCount * itemWidth + padH * 2;
}

function menuTotalOutside(): number {
  const { height, arrow, gap } = MESSAGE_ACTION_MENU_METRICS;
  return height + arrow + gap;
}

function clampHorizontal(
  centerX: number,
  menuWidth: number,
  screenWidth: number,
): { left: number; arrowLeft: number } {
  const { screenEdge, arrow } = MESSAGE_ACTION_MENU_METRICS;
  let left = centerX - menuWidth / 2;
  left = Math.min(Math.max(screenEdge, left), screenWidth - menuWidth - screenEdge);
  const arrowLeft = centerX - left - arrow;
  return { left, arrowLeft };
}

export function computeMessageActionMenuLayout(params: {
  anchor: MessageBubbleAnchor;
  viewport: { top: number; bottom: number };
  compose: RectAnchor;
  itemCount: number;
  screen: { width: number; height: number };
}): MessageActionMenuLayout | null {
  const { anchor, viewport, compose, itemCount, screen } = params;
  if (itemCount <= 0) return null;

  const { height, arrow, gap, insidePad } = MESSAGE_ACTION_MENU_METRICS;
  const menuWidth = menuWidthForItems(itemCount);
  const menuHeight = height;
  const menuTotal = menuTotalOutside();
  const bubbleCenterX = anchor.x + anchor.width / 2;
  const composeCenterX = compose.x + compose.width / 2;

  const spaceAbove = anchor.y - viewport.top;
  const spaceBelow = viewport.bottom - (anchor.y + anchor.height);

  const place = (
    placement: MessageActionMenuPlacement,
    top: number,
    centerX: number,
    arrowAtTop: boolean,
  ): MessageActionMenuLayout => {
    const { left, arrowLeft } = clampHorizontal(centerX, menuWidth, screen.width);
    return {
      left,
      top,
      menuWidth,
      menuHeight,
      arrowLeft,
      placement,
      arrowAtTop,
    };
  };

  if (spaceAbove >= menuTotal) {
    return place(
      'outsideAbove',
      anchor.y - menuHeight - arrow - gap,
      bubbleCenterX,
      false,
    );
  }

  if (spaceAbove > insidePad + arrow) {
    return place('insideTop', anchor.y + insidePad, bubbleCenterX, true);
  }

  if (spaceBelow >= menuTotal) {
    return place(
      'outsideBelow',
      anchor.y + anchor.height + arrow + gap,
      bubbleCenterX,
      true,
    );
  }

  if (spaceBelow > insidePad + arrow) {
    return place(
      'insideBottom',
      anchor.y + anchor.height - menuHeight - insidePad,
      bubbleCenterX,
      false,
    );
  }

  return place(
    'aboveCompose',
    compose.y - menuHeight - arrow - gap,
    composeCenterX,
    false,
  );
}
