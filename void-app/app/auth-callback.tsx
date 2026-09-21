// thevoid://auth-callback#access_token=... — OAuth return when the OS routes the
// redirect into the app (the auth session in authActions usually captures it first).
import React, { useEffect } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { sessionFromOAuthRedirect } from "../src/core/index.ts";
import { ensureCore, pushSessionToSupabase, setSignedInFlag } from "../src/features/auth/coreBridge";
import { applyPendingProfileIfAny } from "../src/features/auth/authActions";
import { env } from "../src/core";
import { RESUME_KEY } from "../src/features/onboarding/onboardAuth";
import { notifyAuthChanged } from "../src/lib/auth";
import { Backdrop } from "../src/ui/Surface";
import { ImageOrbitLoader } from "../src/ui/ImageOrbitLoader";

export default function AuthCallback() {
  const url = Linking.useLinkingURL();
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      notifyAuthChanged();
      // An email sign-up confirmed from the inbox goes back to the flow it left (Ignite).
      let resume = false;
      try {
        resume = env.storage.getItem(RESUME_KEY) === "ignite";
      } catch {}
      router.replace(resume ? "/onboarding?resume=ignite" : "/void");
    };
    if (url && /access_token=/.test(url)) {
      ensureCore()
        .then(() => sessionFromOAuthRedirect(url))
        .then(async (s) => {
          if (s) {
            await pushSessionToSupabase();
            await applyPendingProfileIfAny().catch(() => {});
            setSignedInFlag(true);
          }
        })
        .catch(() => {})
        .finally(finish);
    }
    const t = setTimeout(finish, 8000);
    return () => clearTimeout(t);
  }, [url]);
  return (
    <Backdrop>
      <ImageOrbitLoader label="SIGNING IN" />
    </Backdrop>
  );
}
