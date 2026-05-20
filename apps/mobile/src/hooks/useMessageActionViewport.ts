import { useEffect, useState, type RefObject } from 'react';
import type { View } from 'react-native';
import type { RectAnchor } from '../lib/messageActionMenuLayout';

export type MessageActionViewport = {
  top: number;
  bottom: number;
};

export function useMessageActionViewport(
  listHostRef: RefObject<View | null>,
  composeRef: RefObject<View | null>,
  enabled: boolean,
): { viewport: MessageActionViewport | null; composeRect: RectAnchor | null } {
  const [viewport, setViewport] = useState<MessageActionViewport | null>(null);
  const [composeRect, setComposeRect] = useState<RectAnchor | null>(null);

  useEffect(() => {
    if (!enabled) {
      setViewport(null);
      setComposeRect(null);
      return;
    }

    const measure = () => {
      listHostRef.current?.measureInWindow((_lx, listTop, _lw, _lh) => {
        composeRef.current?.measureInWindow((cx, cy, cw, ch) => {
          setViewport({ top: listTop, bottom: cy });
          setComposeRect({ x: cx, y: cy, width: cw, height: ch });
        });
      });
    };

    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [enabled, listHostRef, composeRef]);

  return { viewport, composeRect };
}
