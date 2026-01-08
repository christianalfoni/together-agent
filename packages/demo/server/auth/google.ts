import { Router } from 'express'
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'

const router = Router()

// Configure Google OAuth Strategy
export function configureGoogleAuth() {
  const clientID = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'

  if (!clientID || !clientSecret) {
    console.warn('Warning: Google OAuth credentials not configured')
    return
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
      },
      async (accessToken, refreshToken, profile, done) => {
        // Store user profile and access token in session
        const user = {
          id: profile.id,
          email: profile.emails?.[0]?.value,
          name: profile.displayName,
          picture: profile.photos?.[0]?.value,
          accessToken,
        }
        return done(null, user)
      }
    )
  )

  passport.serializeUser((user: any, done) => {
    done(null, user)
  })

  passport.deserializeUser((user: any, done) => {
    done(null, user)
  })
}

// Middleware to check if user is authenticated
export function isAuthenticated(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({ error: 'Not authenticated' })
}

// Auth routes
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send(`
      <h1>Google OAuth Not Configured</h1>
      <p>Please create a <code>.env</code> file with your Google OAuth credentials.</p>
      <p>Copy <code>.env.example</code> to <code>.env</code> and fill in your credentials.</p>
      <p><a href="/">Go back</a></p>
    `)
  }

  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    accessType: 'offline',
    prompt: 'consent',
  })(req, res, next)
})

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth_failed' }),
  (req, res) => {
    // Successful authentication, redirect to home
    res.redirect('/')
  }
)

router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' })
    }
    res.json({ success: true })
  })
})

router.get('/user', isAuthenticated, (req, res) => {
  const user = req.user as any
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  })
})

export default router
