# Authentication

Keep Seerr's auth routes, session handling and login components; adapt copy and add the
Jellyfin-new-user rule and app passwords. Screens: `design/screens/01-login.png`,
`01b-plex-signin.png`, `08-logout.png`.

## Sign-in methods (settings `main.localLogin`, `main.mediaServerLogin`, plus new flags)

| Setting key (suggested) | Mockup label | Behavior |
|---|---|---|
| `main.localLogin` | Shufflerr accounts | Email + password form |
| `plex.loginEnabled` | Plex sign-in | "Sign in with Plex" button |
| `main.newPlexLogin` | Let new Plex users sign in | Create account on first Plex sign-in if they have access to the owner's server |
| `jellyfin.loginEnabled` | Jellyfin sign-in | "Sign in with Jellyfin" button → username/password |
| `jellyfin.newLogin` | Let new Jellyfin users sign in | Create account on first Jellyfin sign-in |

Validation: at least one of local / Plex / Jellyfin must stay on (mockup shows a toast
"At least one sign-in method has to stay on.").

## Plex (Seerr's PIN flow — keep `src/hooks/usePlexLogin.ts`, `src/utils/plex.ts`)

1. Client creates a PIN: `POST https://plex.tv/api/v2/pins?strong=true` with
   `X-Plex-Client-Identifier`, `X-Plex-Product: Shufflerr`, `X-Plex-Version`, device headers.
2. Opens a popup to `https://app.plex.tv/auth#?clientID=…&code=<pin.code>&context[device][product]=Shufflerr…`.
3. Polls `GET https://plex.tv/api/v2/pins/<id>` until `authToken` is set (or the popup closes).
4. Sends `authToken` to `POST /api/v1/auth/plex`.
5. Server: fetch Plex account (`plex.tv` user endpoint). Then:
   - No users in DB yet → this user becomes **owner** (id 1, ADMIN). (Setup flow.)
   - Existing user with that `plexId` → update token, sign in.
   - Existing user with same email but no plexId → link and sign in (Seerr behavior).
   - Unknown user → check they have access to the configured Plex server (via owner token /
     server shared users). If yes and `newPlexLogin` on → create with **default permissions**
     and global quotas; else 403 "Your Plex account doesn't have a Shufflerr account yet. Ask the
     server owner to import you."
6. Session cookie (Seerr's express-session + TypeORM store).

The mockup simulates step 2 with an account picker; the real popup is Plex's page.

## Jellyfin (keep Seerr's `/api/v1/auth/jellyfin`)

- Body: `{username, password}` (+ hostname during setup). Server calls Jellyfin
  `Users/AuthenticateByName`, stores `jellyfinUserId`, `jellyfinAuthToken`, device id.
- Unknown Jellyfin user: create if `jellyfin.newLogin` on, else 403 with the copy above
  ("Your Jellyfin account doesn't have a Shufflerr account yet. Ask an admin to import you.").
- Wrong credentials: "Jellyfin didn't accept that username and password."
- Keep Quick Connect support from Seerr (`JellyfinQuickConnectModal`).

## Local accounts

- Email + password (`POST /api/v1/auth/local`). bcrypt as in Seerr.
- Error copy: empty → "Enter your email and password."; unknown → "No Shufflerr account uses
  that email. Try signing in with Plex or Jellyfin."; media-server user without password →
  "This account signs in with Plex. Use the Plex button, or set a password in your profile first."
- Forgot password: Seerr's reset flow (`/resetpassword/[guid]`), only if email agent is on.
  Mockup toast: "If email notifications are set up, a reset link is sent to your address."

## Sign out

- `POST /api/v1/auth/logout` destroys the session → `/logout` page (mockup screen 08):
  "You've signed out" / "Your requests keep going while you're away…" /
  "This signed you out of Shufflerr only. You're still signed in to Plex." / "Sign in again".
- Seerr redirects straight to `/login`; Shufflerr adds this page.

## Login page design (from mockup)

- Full-screen dark background: **album-art slideshow** — 3 layers of a tilted mosaic of
  recently-added covers (via image proxy, 70 tiles per layer, `rotate(-6deg) scale(1.15)`),
  crossfading every 6 s; radial dark overlay for legibility; static when
  `prefers-reduced-motion`. Data: `GET /api/v1/media?filter=allavailable&sort=mediaAdded&take=70`
  (public, cover URLs only — no titles if you prefer privacy; mockup shows titles).
- Wordmark `SHUFFLERR` (letter-spaced, last two letters in accent).
- Two-panel card (7fr / 5fr), layout after the Rekord login page:
  - Left "Sign in": lede, Plex button (Plex orange `#E5A00D`, dark text), Jellyfin button
    (`#7B5CD6`), divider "or use a Shufflerr account", underline inputs with floating labels
    (Email, Password), "Sign in" outline-accent button, "Forgot password?".
  - Right "New here?": explanation of first-sign-in account creation + Plex button.
- Footer line: "Background shows album art from your library. Sign-in and request approvals
  work like Seerr."
- Errors render in a red-tinted box above the buttons (`role="alert"`).
- Only show buttons for enabled methods.

## App passwords (new — for OpenSubsonic/Jellyfin clients)

- Created per user under Profile → Settings → App passwords. Name required.
- Generated server-side: 3×6 base36 groups (`xxxxxx-xxxxxx-xxxxxx`) or longer; shown once.
- Stored as argon2id hash. Subsonic token auth (`t = md5(password + salt)`) needs the plaintext
  on the server — **so for OpenSubsonic, prefer the `apiKey` extension** where clients support
  it, and support legacy `p=` (hex/plain) and token auth by storing an **additional encrypted
  copy** of the app password (encrypted with the server secret). Document this tradeoff in
  CHANGES.md. See `CLIENT_API.md`.
- Revoke = delete row; clients fail on next request.
- Admin view lists all app passwords across users (Apps and devices page) with Revoke.

## Session & security

- Keep Seerr's CSRF option, trust-proxy option (Network page), cookie settings.
- Rate-limit `/auth/*` (e.g. 10/min/IP).
- Never log tokens/passwords; mask in settings responses.
