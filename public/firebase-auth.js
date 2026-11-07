// Firebase owns token persistence and refresh; application code never stores tokens.
export async function initializeFirebaseAuth(config) {
  const version = '10.14.1'; // Same SDK version as the existing shared API browser helper.
  const [appSdk, authSdk, checkSdk] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app-check.js`)
  ]);
  const app = appSdk.initializeApp(config.firebase);
  const auth = authSdk.getAuth(app);
  const provider = config.appCheck.provider === 'recaptcha-enterprise'
    ? new checkSdk.ReCaptchaEnterpriseProvider(config.appCheck.siteKey)
    : new checkSdk.ReCaptchaV3Provider(config.appCheck.siteKey);
  const appCheck = checkSdk.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  await auth.authStateReady();
  return {
    user: () => auth.currentUser,
    async headers() {
      if (!auth.currentUser) throw Object.assign(new Error('Sign in to save your changes.'), { status: 401 });
      const [idToken, attestation] = await Promise.all([auth.currentUser.getIdToken(), checkSdk.getToken(appCheck)]);
      return { Authorization: `Bearer ${idToken}`, 'X-Firebase-AppCheck': attestation.token };
    },
    async google() { return (await authSdk.signInWithPopup(auth, new authSdk.GoogleAuthProvider())).user; },
    async email(email, password, create) {
      const result = create
        ? await authSdk.createUserWithEmailAndPassword(auth, email, password)
        : await authSdk.signInWithEmailAndPassword(auth, email, password);
      return result.user;
    },
    async resetPassword(email) { await authSdk.sendPasswordResetEmail(auth, email); },
    async signOut() { await authSdk.signOut(auth); },
    onChange(callback) { return authSdk.onAuthStateChanged(auth, callback); }
  };
}
