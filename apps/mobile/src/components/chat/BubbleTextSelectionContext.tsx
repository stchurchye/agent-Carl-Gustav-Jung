import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';

type Ctx = {
  activeKey: string | null;
  registerClear: (key: string, clear: () => void) => () => void;
  notifySelection: (key: string, hasSelection: boolean) => void;
  clearActive: () => void;
  /** 本次触摸从消息正文开始（用于区分点空白区域） */
  markTextTouch: () => void;
  tryDismissOnTouchEnd: () => void;
};

const BubbleTextSelectionContext = createContext<Ctx | null>(null);

const clearActiveRef: { current: (() => void) | null } = { current: null };
const tryDismissOnTouchEndRef: { current: (() => void) | null } = { current: null };

export function bubbleTextSelectionClearActive() {
  clearActiveRef.current?.();
}

/** 手指抬起时：若未点在正文上则取消选中（挂在 FlatList 上） */
export function bubbleTextSelectionTryDismissOnTouchEnd() {
  tryDismissOnTouchEndRef.current?.();
}

export function BubbleTextSelectionProvider({ children }: { children: ReactNode }) {
  const clearFnsRef = useRef(new Map<string, () => void>());
  const activeKeyRef = useRef<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const touchFromTextRef = useRef(false);

  const registerClear = useCallback((key: string, clear: () => void) => {
    clearFnsRef.current.set(key, clear);
    return () => {
      clearFnsRef.current.delete(key);
    };
  }, []);

  const clearActive = useCallback(() => {
    const key = activeKeyRef.current;
    if (key) {
      clearFnsRef.current.get(key)?.();
    }
    setActiveKey(null);
    activeKeyRef.current = null;
  }, []);

  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const notifySelection = useCallback((key: string, hasSelection: boolean) => {
    if (hasSelection) {
      const prev = activeKeyRef.current;
      if (prev && prev !== key) {
        clearFnsRef.current.get(prev)?.();
      }
      activeKeyRef.current = key;
      setActiveKey(key);
      return;
    }
    if (activeKeyRef.current === key) {
      activeKeyRef.current = null;
      setActiveKey(null);
    }
  }, []);

  const markTextTouch = useCallback(() => {
    touchFromTextRef.current = true;
  }, []);

  const tryDismissOnTouchEnd = useCallback(() => {
    if (!touchFromTextRef.current && activeKeyRef.current) {
      clearActive();
    }
    touchFromTextRef.current = false;
  }, [clearActive]);

  useEffect(() => {
    clearActiveRef.current = clearActive;
    tryDismissOnTouchEndRef.current = tryDismissOnTouchEnd;
    return () => {
      clearActiveRef.current = null;
      tryDismissOnTouchEndRef.current = null;
    };
  }, [clearActive, tryDismissOnTouchEnd]);

  const value = useMemo(
    () => ({
      activeKey,
      registerClear,
      notifySelection,
      clearActive,
      markTextTouch,
      tryDismissOnTouchEnd,
    }),
    [activeKey, registerClear, notifySelection, clearActive, markTextTouch, tryDismissOnTouchEnd],
  );

  return (
    <BubbleTextSelectionContext.Provider value={value}>
      <View style={styles.host}>{children}</View>
    </BubbleTextSelectionContext.Provider>
  );
}

export function useBubbleTextSelection() {
  return useContext(BubbleTextSelectionContext);
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
});
