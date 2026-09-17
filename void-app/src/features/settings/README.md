# features/settings

`SettingsScreen` (`/settings`) contains:
- **Identity**: name/handle/bio, SIGN OUT, DELETE → `DeleteAccountSheet`.
- **Language**.
- **Appearance**: VOID/DARK/LIGHT cards and Match system, with "VOID STAYS VOID" from the theme.
- **Content**: Autoplay, Notifications, Hide graphic content, Dense grid `v_grid3`.
- **Safety**: Blocked accounts → `BlockedAccountsScreen` in a Modal, Contact & support, Terms of use.
- **Body signals**: `useSensing().openConsent()`. ConsentScreen itself is not edited.
- **About**: Clear All Data.
- SAVE CHANGES.

`vmod.tsx` holds the shared `.vmod-*` sheet vocabulary and `Toggle`. `prefs.ts` holds `usePrefs()` for `v_lang`/`v_autoplay`/`v_notify`/`v_grid3`.

## Deviations
- `SUPPORT_EMAIL` is re-exported from core with a TODO: replace it before submission.
- **Dense grid toggle**: the web removed it (the grid is a build property, 2-wide on mobile). It was restored on request. It defaults to off and nothing reads it yet; the feed should use `usePrefs().grid3`.
- Language is a sheet picker (there is no native `<select>`).
- Body signals is a native-only section.
- On DARK/LIGHT the settings background uses `--bg-radial`. The web hardcoded the purple radial for every theme.
- Delete account:
  - The web `.da-sheet` padding is 10/24 with a 36×4 handle. The shared `Sheet` uses 22 with 32×3.
  - After success, supabase-js is signed out locally and AsyncStorage user keys are cleared. "RETURN TO SIGN-IN" or a 6s timer routes to `/sign-in` (the web reloaded the page).
- Clear All Data uses a native Alert and keeps device keys (theme, backend overrides). The web cleared all of localStorage.
