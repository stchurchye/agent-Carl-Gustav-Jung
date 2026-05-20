import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppAlertProvider } from './src/components/AppAlertProvider';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { AuthGate } from './src/components/AuthGate';
import { RootTabs } from './src/navigation/RootTabs';

export default function App() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <AppAlertProvider>
          <AuthGate>
            <NavigationContainer>
              <StatusBar style="dark" />
              <RootTabs />
            </NavigationContainer>
          </AuthGate>
        </AppAlertProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
