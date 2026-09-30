# SCSN group API — implementation spec

What SCSN must expose for the RoProtect extension to source **group** verdicts and
**tracked users** from SCSN instead of the first-party Rotector backend.

Owner: SCSN. Consumers: `roprotect-extension`.

---

## 1. Endpoints to add

All paths are relative to the same origin the extension already talks to
(`API_CONFIG.BASE_URL` — `https://roprotect.tlet.xyz` in production,
`https://roprotect-dev.tlet.xyz` in dev builds).

Note the doubled version segment: `/v1/<provider>/v1/...`. This matches the
convention already used by the per-provider user routes
(`/v1/scsn/v1/lookup/user/{userId}`), which the extension discovers via
`/v1/extension/whoami` and falls back to when the server omits them.

| Method | Path                                                      | Purpose                    |
| ------ | --------------------------------------------------------- | -------------------------- |
| `GET`  | `/v1/scsn/v1/lookup/roblox/group/{groupId}`               | Single group verdict       |
| `POST` | `/v1/scsn/v1/lookup/roblox/group`                         | Batch group verdicts       |
| `GET`  | `/v1/scsn/v1/lookup/roblox/group/{groupId}/tracked-users` | Tracked members, paginated |

There is **no** batch `tracked-users` route. The extension paginates the single
route with a cursor.

---

## 2. Requests

### 2.1 Single group verdict

```
GET /v1/scsn/v1/lookup/roblox/group/{groupId}
```

- `groupId` is a Roblox group ID, decimal string in the path. The extension
  sanitizes it before sending but does not transform it.
- No query parameters.

### 2.2 Batch group verdicts

```
POST /v1/scsn/v1/lookup/roblox/group
Content-Type: application/json

{ "ids": [123456, 789012] }
```

- `ids` is an array of **numbers** (not strings). Sent as JSON, no wrapper key.
- Order is not significant; the extension re-associates by ID.

### 2.3 Tracked users

```
GET /v1/scsn/v1/lookup/roblox/group/{groupId}/tracked-users?limit=24&cursor=<opaque>&active=true
```

| Param    | Type                  | Notes                                                                                              |
| -------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `limit`  | int                   | Extension sends its own value, **clamped to 100** client-side. Default from the extension is `24`. |
| `cursor` | string                | Opaque. Omitted on first page. Echo back the `nextCursor` you returned.                            |
| `active` | `"true"` \| `"false"` | Optional. String, not boolean. Omitted when unset.                                                 |

### 2.4 Headers on all three

Built by `buildRotectorHeaders` in `src/entrypoints/background/http-client.ts:78`.

| Header              | Required          | Value                                                                                                                                     |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Installation-ID` | yes               | Stable per-install UUID. Sent on every request.                                                                                           |
| `X-Auth-Token`      | if user has a key | Raw API key, no scheme prefix. Omitted entirely when unset.                                                                               |
| `Authorization`     | if present        | `Bearer <token>`. Membership key where available, else the API key.                                                                       |
| `X-Device-FP`       | optional          | Cached device fingerprint. **Only sent after the user accepts the legal gate** — it will be absent on cold/first runs. Do not require it. |
| `X-Client-ID`       | optional          | Identifies the originating page.                                                                                                          |
| `X-Lookup-Context`  | optional          | Free-form scan context.                                                                                                                   |

`X-Read-Primary` is **never** sent on group calls. It is a user-lookup-only header.
Do not make any of these headers mandatory except `X-Installation-ID`.

---

## 3. Responses

### 3.1 Group verdict

Validated by `GroupStatusSchema` (`src/lib/schemas/rotector.ts:62`) via valibot.

```json
{
	"id": 123456,
	"flagType": 2,
	"confidence": 0.87,
	"reasons": {
		"User Profile": {
			"confidence": 0.9,
			"message": "Description contains a direct off-platform contact link.",
			"evidence": ["line 1: 'discord.gg/...'"]
		}
	}
}
```

| Field        | Required | Type                     | Notes                                           |
| ------------ | -------- | ------------------------ | ----------------------------------------------- |
| `id`         | **yes**  | number                   | Group ID.                                       |
| `flagType`   | **yes**  | number                   | Enum below. Unknown values are coerced to `-1`. |
| `confidence` | no       | number                   | Defaults to `0`.                                |
| `reasons`    | no       | `Record<string, Reason>` | Defaults to `{}`.                               |

`reasons` values (`ReasonSchema`, `rotector.ts:21`):

| Field        | Required | Type                 |
| ------------ | -------- | -------------------- |
| `confidence` | **yes**  | number               |
| `message`    | no       | string               |
| `evidence`   | no       | `string[]` or `null` |

`null` is accepted for `message` / `evidence` and normalized to absent
(`NullableString` in `src/lib/schemas/common.ts`).

### 3.2 `flagType` — the part most likely to break

Only these seven values are accepted for groups. They are a **narrower** set than
the user endpoint:

| Value | Constant        | Meaning                                       |
| ----- | --------------- | --------------------------------------------- |
| `0`   | `SAFE`          |                                               |
| `1`   | `PENDING`       |                                               |
| `2`   | `UNSAFE`        |                                               |
| `3`   | `QUEUED`        |                                               |
| `5`   | `MIXED`         |                                               |
| `6`   | `PAST_OFFENDER` |                                               |
| `-1`  | `UNKNOWN`       | Also the fallback for any unrecognized value. |

`4` (`PROVISIONAL`) and `8` (`REDACTED`) exist for **user** verdicts only and are
**rejected** on the group route. Omit the field rather than guessing, or send `-1`.

### 3.3 Batch group verdicts

A flat map keyed by ID:

```json
{
	"123456": { "id": 123456, "flagType": 2, "confidence": 0.87, "reasons": {} },
	"789012": { "id": 789012, "flagType": 0, "confidence": 0.04, "reasons": {} }
}
```

- Keys are stringified IDs (`Record<string, GroupStatusSchema>`). The extension
  does `Object.values(map)`, so exact key form is not load-bearing — but string
  keys are the convention.
- **Every returned entry must still satisfy `GroupStatusSchema`, including the
  required `id` and `flagType`.** A clean group must be present with
  `flagType: 0`, not omitted. Omitting a requested ID is the correct way to
  signal "unknown" — do not return a partial object.

### 3.4 Tracked users

`GroupTrackedUsersSchema` (`rotector.ts:118`):

```json
{
	"users": [
		{
			"id": 111,
			"name": "someuser",
			"displayName": "SomeUser",
			"thumbnailUrl": "https://tr.rbxcdn.com/…/AvatarHeadshot.png",
			"isActive": true
		}
	],
	"totalCount": 137,
	"nextCursor": "eyJpZCI6MTM3fQ==",
	"hasMore": true
}
```

| Field        | Required | Type             | Notes                                         |
| ------------ | -------- | ---------------- | --------------------------------------------- |
| `users`      | **yes**  | `TrackedUser[]`  | May be empty.                                 |
| `totalCount` | **yes**  | number           | Total across all pages, not page length.      |
| `nextCursor` | **yes**  | `string \| null` | Must be present. Use `null` on the last page. |
| `hasMore`    | **yes**  | boolean          | Must agree with `nextCursor !== null`.        |

`TrackedUserSchema` (`rotector.ts:110`):

| Field          | Required | Type             | Notes                                                              |
| -------------- | -------- | ---------------- | ------------------------------------------------------------------ |
| `id`           | **yes**  | number           | Roblox user ID.                                                    |
| `name`         | **yes**  | string           | Username.                                                          |
| `displayName`  | **yes**  | string           | Display name.                                                      |
| `thumbnailUrl` | **yes**  | `string \| null` | `null` allowed, normalized to absent. **The key must be present.** |
| `isActive`     | **yes**  | boolean          | Drives the `active` filter.                                        |

---

## 4. Error handling contract

The extension does **not** tolerate errors on these routes gracefully today. The
client-side fallback (try/catch → synthetic `UNKNOWN` verdict) is being added on
the extension side, so a failure degrades to an "unknown" chip rather than a
broken page. Until that lands:

- **Non-2xx or a network error throws** out of `makeHttpRequest`.
- **A 2xx body that fails valibot also throws.**

Practical guidance while both are being hardened:

- Return a schema-valid `UNKNOWN` verdict rather than an error when you can
  answer at all. `flagType: -1` with `reasons: {}` is always safe.
- Reserve 5xx for genuine unavailability, and prefer 200 + `UNKNOWN` for
  "I have no data for this group" so the UI stays quiet.

---

## 5. Extension-side change that depends on this work

`src/lib/types/constants.ts` — `API_CONFIG.ENDPOINTS.GROUP_CHECK` currently holds
the first-party route `/v1/lookup/roblox/group`, consumed by two callers:

- `checkGroupStatus` (`src/entrypoints/background/endpoints/core.ts:52`) → single GET
- `checkMultipleGroups` (`core.ts:97`) → batch POST
- `getGroupTrackedUsers` (`core.ts:177`) → appends `/{id}/tracked-users`

Because the third caller derives a sub-route from the same constant, the constant
is being split so a partial SCSN rollout cannot break the member carousel. The
extension change is blocked on SCSN serving all three routes above.

**SCSN must serve `tracked-users` before the extension switch is safe.**
