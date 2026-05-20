import { useEffect, useState, type ReactNode } from 'react';
import { AppAlertDialog } from './AppAlertDialog';
import { AppPromptDialog } from './AppPromptDialog';
import {
  registerAppAlert,
  type AppAlertButton,
  type AppAlertOptions,
} from '../lib/appAlert';
import { registerAppPrompt, type AppPromptRequest } from '../lib/appPrompt';

const DEFAULT_BUTTONS: AppAlertButton[] = [{ text: '确定' }];

export function AppAlertProvider({ children }: { children: ReactNode }) {
  const [alert, setAlert] = useState<AppAlertOptions | null>(null);
  const [prompt, setPrompt] = useState<AppPromptRequest | null>(null);

  useEffect(() => {
    registerAppAlert((options) => setAlert(options));
    registerAppPrompt((request) => setPrompt(request));
    return () => {
      registerAppAlert(null);
      registerAppPrompt(null);
    };
  }, []);

  const buttons = alert?.buttons?.length ? alert.buttons : DEFAULT_BUTTONS;

  const finishPrompt = (value: string | null) => {
    const current = prompt;
    setPrompt(null);
    current?.resolve(value);
  };

  return (
    <>
      {children}
      {alert ? (
        <AppAlertDialog
          visible
          title={alert.title}
          message={alert.message}
          buttons={buttons}
          onDismiss={() => setAlert(null)}
        />
      ) : null}
      {prompt ? (
        <AppPromptDialog
          visible
          title={prompt.title}
          message={prompt.message}
          defaultValue={prompt.defaultValue}
          onCancel={() => finishPrompt(null)}
          onConfirm={(value) => finishPrompt(value)}
        />
      ) : null}
    </>
  );
}
