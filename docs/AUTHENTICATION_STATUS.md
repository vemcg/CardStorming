# Authentication System - Implementation Status

## Branch: feature/users-and-accounts

## Overview

Complete user authentication and identity management system for CardStorming. Allows multiple users to collaborate on projects with unique identities, supports multiple identities per user across different projects, and implements read-only mode for unauthenticated access.

## Commits

1. **Add user authentication system foundation (server-side)** - c4d09d4
   - Server-side user management
   - API endpoints
   - Client-side Auth.js module
   - Dialog HTML/CSS

2. **Add client-side dialog utilities for authentication** - c5c09dc
   - DialogUtils.js with reusable dialogs
   - Registration and identity selection flows

3. **Add integration guide for authentication system** - 90d5299
   - Complete step-by-step integration instructions
   - INTEGRATION_TODO.md

## What's Implemented

### ✅ Server-Side (100% Complete)

**User Management:**
- Hash-based user IDs from email
- User profile storage (`data/users/{userHash}.json`)
- Default identity (name/initials)
- Per-project identity overrides
- Project membership tracking

**Project ACL:**
- User lists per project
- Conflict detection for duplicate initials
- Multiple identities per user in same project

**API Endpoints (9 total):**
```
POST   /api/user/register
GET    /api/user/:userHash
GET    /api/user/:userHash/identities
GET    /api/user/:userHash/projects
POST   /api/project/:projectHash/check-identity
POST   /api/project/:projectHash/users
GET    /api/project/:projectHash/user/:userHash/identities
GET    /api/project/:projectHash/users
```

### ✅ Client-Side Foundation (100% Complete)

**Auth.js Module:**
- Cookie-based session management
- User registration
- Identity management
- Project membership
- Read-only mode state
- All API integrations

**DialogUtils.js:**
- `showRegistrationDialog()` - Email, name, initials input
- `showIdentityDialog()` - Select existing or create new identity
- `showReadOnlyBanner()` / `hideReadOnlyBanner()`
- Conflict checking support
- Promise-based async API

**HTML/CSS:**
- Registration modal (#register-modal)
- Identity selection modal (#identity-modal)
- Read-only banner styling
- All form validation

**Documentation:**
- USER_AUTHENTICATION.md - Complete system design
- INTEGRATION_TODO.md - Integration instructions
- AUTHENTICATION_STATUS.md - This file

## What Needs Integration

The system is **architecturally complete** but not yet **integrated into app.js**.

See [INTEGRATION_TODO.md](./INTEGRATION_TODO.md) for detailed instructions.

**Summary of integration work:**
1. Import Auth and DialogUtils modules
2. Initialize auth on startup
3. Add `updateUIForAuthState()` function
4. Modify File > New to show registration/identity dialogs
5. Modify File > Open to filter user's projects
6. Add identity selection when opening projects
7. Implement read-only mode in `openProject()`
8. Add `requireWriteAccess()` wrapper
9. Wrap all write operations with access check
10. Use auth identity for card authorship

## User Flows

### Flow 1: New User Creates Project
1. Visit site (no cookie) → UI disabled except File > New
2. Click File > New → Registration dialog
3. Enter email/name/initials → User created
4. Identity selection dialog → Choose identity
5. Project created → User added to ACL
6. Full write access granted

### Flow 2: Returning User Creates Project
1. Visit site (has cookie) → Load user profile
2. Click File > New → Identity selection
3. Select existing or create new → Set identity
4. Project created → Full access

### Flow 3: New User Joins via Link
1. Click project link (no cookie) → Read-only mode
2. Try to edit → Triggers registration
3. Register → Identity selection
4. Join project → Write access granted

### Flow 4: Returning User Joins via Link
1. Click project link (has cookie) → Check membership
2. If member → Use existing identity → Write access
3. If not member → Read-only mode → Auth on edit

### Flow 5: User with Multiple Identities Opens Project
1. File > Open → Select project
2. Identity selection → Choose from identities in project
3. Or create new identity (checks conflicts)
4. Load with selected identity

## Data Structures

### User Profile
```json
{
  "userHash": "abc123...",
  "email": "user@example.com",
  "defaultName": "John Doe",
  "defaultInitials": "JD",
  "projects": ["project1", "project2"],
  "identities": {
    "project1": { "name": "John Doe", "initials": "JD" },
    "project2": { "name": "Johnny D", "initials": "JD2" }
  }
}
```

### Project ACL
```json
{
  "projectHash": "project123",
  "users": [
    { "userHash": "abc123", "name": "John Doe", "initials": "JD" },
    { "userHash": "def456", "name": "Jane Smith", "initials": "JS" }
  ],
  "cards": [...],
  "wormholes": [...],
  "palette": [...]
}
```

## Testing

Once integrated, test:
- ✓ New user registration flow
- ✓ Identity selection with multiple options
- ✓ Project creation as authenticated user
- ✓ Read-only mode for unauthenticated users
- ✓ Write operation triggers registration
- ✓ File > Open filters user projects
- ✓ Multiple identities in same project
- ✓ Conflict detection for duplicate initials
- ✓ Cookie persistence across sessions
- ✓ Logout and re-authentication

## Next Steps

1. **Integrate into app.js** - Follow INTEGRATION_TODO.md
2. **Test all flows** - Use testing checklist
3. **Fix any bugs** - Iterate on edge cases
4. **Merge to main** - Once stable and tested

## Migration (Future)

Eventually add admin link to claim all existing projects:
- Creates user for admin
- Adds admin to all project ACLs
- Updates all cards with admin initials
- One-time operation

## Files Modified

**New Files:**
- `js/core/Auth.js`
- `js/utils/DialogUtils.js`
- `docs/USER_AUTHENTICATION.md`
- `docs/INTEGRATION_TODO.md`
- `docs/AUTHENTICATION_STATUS.md`

**Modified Files:**
- `server.js` - User management functions, API endpoints
- `public/index.html` - Auth dialogs
- `css/style.css` - Dialog and banner styles
- `.claude/settings.local.json` - Project settings

**To Be Modified:**
- `js/app.js` - Main integration (see INTEGRATION_TODO.md)

## Estimated Integration Time

With the detailed guide, integration should take approximately:
- Reading/understanding code: 10 minutes
- Implementing changes: 20-30 minutes
- Testing: 15-20 minutes
- Debugging: 10-15 minutes

**Total: ~1 hour** (assuming no major issues)

## Notes

- System uses email-based hashing for user IDs
- Initials are case-insensitive, stored uppercase
- Conflicts only check initials, not names
- Same user can have different identities in different projects
- Read-only mode allows pan/zoom/view but no modifications
- Cookie expires after 365 days
