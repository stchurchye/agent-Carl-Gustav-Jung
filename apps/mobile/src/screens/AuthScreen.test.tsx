import { render } from '@testing-library/react-native';
import { AuthScreen } from './AuthScreen';
import { BRAND_NAME } from '../lib/brand';

it('登录页品牌名为 Bow Wow Know', () => {
  const { getByText, queryByText } = render(<AuthScreen onAuthenticated={jest.fn()} />);
  expect(getByText(BRAND_NAME)).toBeTruthy();
  expect(queryByText('agent-Carl-Gustav-Jung')).toBeNull();
});
