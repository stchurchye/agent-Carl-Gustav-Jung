import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import { colors } from '../../theme/colors';
import { useBubbleTextSelection } from './BubbleTextSelectionContext';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  selectionKey?: string;
  onLongPressMenu?: () => void;
};

const LONG_PRESS_MS = 450;

type SelectionRange = { start: number; end: number };

export function SelectableBubbleText({
  text,
  style,
  selectionKey,
  onLongPressMenu,
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionCtx = useBubbleTextSelection();
  const [selection, setSelection] = useState<SelectionRange | undefined>(undefined);

  const clearSelection = useCallback(() => {
    setSelection({ start: 0, end: 0 });
    inputRef.current?.blur();
    requestAnimationFrame(() => setSelection(undefined));
    if (selectionKey) {
      selectionCtx?.notifySelection(selectionKey, false);
    }
  }, [selectionCtx, selectionKey]);

  useEffect(() => {
    if (!selectionKey || !selectionCtx) return;
    return selectionCtx.registerClear(selectionKey, clearSelection);
  }, [selectionKey, selectionCtx, clearSelection]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const selectAllAndOpenMenu = useCallback(() => {
    const len = text.length;
    if (len > 0) {
      setSelection({ start: 0, end: len });
      if (selectionKey) {
        selectionCtx?.notifySelection(selectionKey, true);
      }
    }
    onLongPressMenu?.();
  }, [text, onLongPressMenu, selectionCtx, selectionKey]);

  const onPressIn = useCallback(() => {
    selectionCtx?.markTextTouch();
    if (!onLongPressMenu) return;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      selectAllAndOpenMenu();
    }, LONG_PRESS_MS);
  }, [clearLongPressTimer, onLongPressMenu, selectAllAndOpenMenu, selectionCtx]);

  const onPressOut = useCallback(() => {
    clearLongPressTimer();
  }, [clearLongPressTimer]);

  const onSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const next = e.nativeEvent.selection;
      setSelection(next);
      if (!selectionKey || !selectionCtx) return;
      selectionCtx.notifySelection(selectionKey, next.end > next.start);
    },
    [selectionCtx, selectionKey],
  );

  return (
    <TextInput
      ref={inputRef}
      value={text}
      editable={false}
      multiline
      scrollEnabled={false}
      showSoftInputOnFocus={false}
      caretHidden
      contextMenuHidden
      selection={selection}
      selectionColor={colors.primary}
      underlineColorAndroid="transparent"
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onSelectionChange={onSelectionChange}
      style={[style, styles.input]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    padding: 0,
    margin: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    ...(Platform.OS === 'android' ? { textAlignVertical: 'top' as const } : {}),
  },
});
