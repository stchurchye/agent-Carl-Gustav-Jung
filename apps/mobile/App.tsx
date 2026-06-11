import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppAlertProvider } from './src/components/AppAlertProvider';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { AuthGate } from './src/components/AuthGate';
import { RootTabs } from './src/navigation/RootTabs';
import { devAutoNavigate } from './src/lib/devAutoNavigate';

const navRef = createNavigationContainerRef<Record<string, unknown>>();

export default function App() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <AppAlertProvider>
          <AuthGate>
            <NavigationContainer ref={navRef} onReady={() => devAutoNavigate(navRef)}>
              <StatusBar style="dark" />
              <RootTabs />
            </NavigationContainer>
          </AuthGate>
        </AppAlertProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
