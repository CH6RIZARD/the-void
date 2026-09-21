import { Redirect } from 'expo-router';
import { isOnboarded } from '../src/features/onboarding/flag';

// Cold start. Core storage is hydrated before the Stack renders (Shell waits on
// bootCore), so the flag read here is the persisted one.
export default function Index() {
  return <Redirect href={isOnboarded() ? '/void' : '/onboarding'} />;
}
