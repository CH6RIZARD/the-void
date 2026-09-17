// useClaimAudio() that tolerates a missing <AudioOwnerProvider> (app/_layout.tsx
// currently stubs it). useAudioOwner reads the context first and only then throws,
// so the hook order is identical either way.
import { useClaimAudio } from '../live/AudioOwner';

export function useSafeClaimAudio(): ReturnType<typeof useClaimAudio> | null {
  try {
    return useClaimAudio();
  } catch {
    return null;
  }
}
