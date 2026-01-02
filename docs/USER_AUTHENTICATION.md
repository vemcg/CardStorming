# User Authentication and Identity System

## Overview

CardStorming uses a cookie-based authentication system where users can have multiple display identities across different projects while maintaining a single user account.

## Data Structures

### User Profile (Server-side)
Stored in `data/users/{userHash}.json`

```json
{
  "userHash": "abc123def456...",
  "email": "user@example.com",
  "defaultName": "John Doe",
  "defaultInitials": "JD",
  "projects": ["project123", "project456"],
  "identities": {
    "project123": { "name": "John Doe", "initials": "JD" },
    "project456": { "name": "Johnny D", "initials": "JD2" }
  }
}
```

### Project ACL (Server-side)
Stored within project data at `data/projects/{projectHash}.json`

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

### Client Cookie
```
cardstorming_user=abc123def456...
```

## User Flows

### Flow 1: New User Creates Project
1. Visit site (no cookie)
2. UI disabled except File → New
3. Click File → New
4. Registration dialog:
   - Email
   - Name
   - Initials
5. Generate userHash from email
6. Store user profile
7. Set cookie
8. Create project with user in ACL
9. Full access granted

### Flow 2: Returning User Creates Project
1. Visit site (has cookie)
2. Load user profile
3. Click File → New
4. Identity selection dialog:
   - Radio: "John Doe (JD)" (default)
   - Radio: "Johnny D (JD2)" (from other projects)
   - Radio: "Other (enter new)"
   - If Other: Name and Initials fields
5. Create project with selected identity

### Flow 3: User Joins via Project Link (No Cookie)
1. Click link with project hash
2. No cookie found
3. Project loads in read-only mode
4. User attempts write operation
5. Registration dialog (same as Flow 1)
6. Add user to project ACL
7. Grant read/write access

### Flow 4: Returning User Joins via Project Link
1. Click link with project hash
2. Has cookie, load user profile
3. Check if user already in project ACL
   - If yes: Load with existing identity
   - If no: Project loads read-only
4. If read-only and user attempts write:
5. Identity selection dialog:
   - Show available identities (filter conflicts)
   - Include "Other" option
6. Add identity to project ACL
7. Grant read/write access

### Flow 5: User Opens Existing Project (Multiple Identities)
1. File → Open
2. Show only projects user is member of
3. Select project where user has multiple identities
4. Identity selection dialog:
   - Radio: "John Doe (JD)"
   - Radio: "Johnny D (JD2)"
   - Radio: "Other (enter new)"
5. Load project with selected identity

## API Endpoints

### GET /api/user/:userHash
Returns user profile

### POST /api/user/register
Creates new user
- Body: { email, name, initials }
- Returns: { userHash, user }

### POST /api/user/:userHash/identity
Adds new identity to user profile for a project
- Body: { projectHash, name, initials }
- Validates no conflict in project
- Returns: { success, identity }

### GET /api/project/:projectHash/users
Returns project ACL (list of users)

### POST /api/project/:projectHash/users
Adds user to project
- Body: { userHash, name, initials }
- Validates no conflict
- Returns: { success }

## Conflict Detection

When adding a user identity to a project:
1. Check if name/initials pair already exists in project ACL
2. If exists and userHash is different: CONFLICT
3. If exists and userHash is same: Already registered with this identity
4. If not exists: OK to add

## Read-Only Mode

When user is not authenticated or not in project ACL:
- ✅ Pan/zoom viewport
- ✅ Use zoom search tool
- ✅ Read card content
- ✅ View wormholes
- ❌ Drag cards
- ❌ Edit cards
- ❌ Delete cards
- ❌ Create cards
- ❌ Edit palette
- ❌ Create wormholes
- ❌ Delete wormholes
